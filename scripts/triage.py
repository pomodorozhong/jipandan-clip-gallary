"""Local triage page: import exported clips, tag them, and publish them to GitHub Pages.

Usage:
    python3 scripts/triage.py [--port 8770] [--no-browser]

Or double-click Triage.command in Finder. The page opens in your browser; close
the terminal window (or press Ctrl+C) to stop it.

Imported clips wait in inbox/ (ignored by git, so they stay on this computer)
until they have a source game and a use case. Publish then moves them into
src/clips/ and src/data/clips.json, commits those two paths on the checked-out
branch, and pushes it. On main that updates the GitHub Pages site; on any other
branch the clips go live once that branch is merged into main.

Needs only Python 3 and git; no packages to install.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import shutil
import subprocess
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "src"                      # the published site
PAGE = REPO / "triage"                   # the triage page's own files
INBOX = REPO / "inbox"                   # imported clips not published yet (git-ignored)
DATA = SITE / "data" / "clips.json"
INBOX_DATA = INBOX / "clips.json"
LIVE_BRANCH = "main"                     # the branch GitHub Pages publishes
AUDIO_SUFFIXES = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac", ".webm"}
MAX_UPLOAD = 200 * 1024 * 1024

mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/ogg", ".opus")
mimetypes.add_type("text/javascript", ".js")


class Refused(Exception):
    """A request the page should show as an error message."""

    def __init__(self, message: str, status: int = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


def read_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""


_hash_cache: dict[Path, tuple[int, int, str]] = {}


def audio_hashes() -> dict:
    """SHA-256 of every audio file under src/clips/ and inbox/clips/, keyed by its `audio` value.

    The page uses them to spot an export file that is already in the gallery under any name, and
    to see which file names are taken. Hashes are cached by size and modification time.
    """
    out = {}
    for base in (SITE, INBOX):
        root = base / "clips"
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in AUDIO_SUFFIXES or path.name.startswith("."):
                continue
            st = path.stat()
            cached = _hash_cache.get(path)
            if not cached or cached[:2] != (st.st_size, st.st_mtime_ns):
                cached = (st.st_size, st.st_mtime_ns, digest(path))
                _hash_cache[path] = cached
            rel = path.relative_to(base).as_posix()
            out.setdefault(rel.replace("%", "%25").replace("#", "%23"), cached[2])
    return out


def audio_file(base: Path, audio: str) -> Path:
    """Map a clip's `audio` value (a URL path such as clips/game/a%23b.mp3) to a file under base."""
    if not isinstance(audio, str) or not audio.startswith("clips/"):
        raise Refused(f"audio must start with clips/: {audio!r}")
    path = (base / unquote(audio)).resolve()
    if not path.is_relative_to((base / "clips").resolve()) or path.suffix.lower() not in AUDIO_SUFFIXES:
        raise Refused(f"not an audio path under clips/: {audio!r}")
    return path


def is_local(audio) -> bool:
    return isinstance(audio, str) and audio.startswith("clips/")


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise Refused(f"git {' '.join(args)} failed: {(result.stderr or result.stdout).strip()}", HTTPStatus.CONFLICT)
    return result.stdout.strip()


def compare_url(branch: str) -> str:
    """GitHub link for opening a pull request from branch into main, or "" if origin is not on GitHub."""
    url = git("remote", "get-url", "origin", check=False)
    for prefix in ("https://github.com/", "git@github.com:", "ssh://git@github.com/"):
        if url.startswith(prefix):
            repo = url[len(prefix):].removesuffix("/").removesuffix(".git")
            return f"https://github.com/{repo}/compare/{LIVE_BRANCH}...{quote(branch, safe='/')}?expand=1"
    return ""


def clean_clip(c) -> dict:
    if not isinstance(c, dict) or not isinstance(c.get("title"), str) or not c["title"].strip():
        raise Refused("every clip needs a title")
    if not isinstance(c.get("audio"), str):
        raise Refused(f"clip {c.get('title')!r} needs an audio path")
    return {k: v for k, v in c.items() if isinstance(k, str) and v not in (None, "", [])}


def state() -> dict:
    published = read_json(DATA, {"dimensions": [], "clips": []})
    inbox = read_json(INBOX_DATA, {"clips": []})
    missing = [c["audio"] for c in published.get("clips", []) if is_local(c.get("audio")) and not audio_file(SITE, c["audio"]).is_file()]
    branch = git("branch", "--show-current", check=False)
    return {
        "published": published,
        "inbox": inbox,
        "missing": missing,
        "hashes": audio_hashes(),
        "version": digest(DATA),
        "branch": branch,
        "canPublish": bool(branch),
        "liveBranch": LIVE_BRANCH,
        "compareUrl": compare_url(branch) if branch and branch != LIVE_BRANCH else "",
    }


def publish(body: dict) -> dict:
    """Write the edited published list, move newly published audio out of the inbox, commit and push the current branch."""
    branch = git("branch", "--show-current")
    if not branch:
        raise Refused("Publishing needs a branch checked out; this checkout is not on a branch.", HTTPStatus.CONFLICT)
    if body.get("version") != digest(DATA):
        raise Refused("src/data/clips.json changed since the page loaded. Reload the page and try again.", HTTPStatus.CONFLICT)
    if git("status", "--porcelain", "--", "src/data/clips.json"):
        raise Refused("src/data/clips.json has uncommitted changes. Commit or discard them first.", HTTPStatus.CONFLICT)

    # Bring the branch up to date first, so the push is a fast-forward. A branch never pushed has nothing to pull.
    if git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}", check=False):
        git("pull", "--ff-only", "--quiet")
    if body.get("version") != digest(DATA):
        raise Refused("GitHub had newer clips. Reload the page to see them, then publish again.", HTTPStatus.CONFLICT)

    published = body.get("published") or {}
    clips = [clean_clip(c) for c in published.get("clips", [])]
    inbox_clips = [clean_clip(c) for c in (body.get("inbox") or {}).get("clips", [])]
    seen = set()
    for c in clips + inbox_clips:
        if c["audio"] in seen:
            raise Refused(f"two clips use the same audio file: {c['audio']}")
        seen.add(c["audio"])

    moves = []
    for c in clips:
        if not is_local(c["audio"]):
            continue
        site_file = audio_file(SITE, c["audio"])
        inbox_file = audio_file(INBOX, c["audio"])
        if inbox_file.is_file():
            moves.append((inbox_file, site_file))
    for src, dest in moves:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(src, dest)
    for d in sorted({p.parent for p, _ in moves}, key=lambda p: len(p.parts), reverse=True):
        while d != INBOX and d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            d = d.parent

    dims = [d for d in published.get("dimensions", []) if isinstance(d, dict) and d.get("key")]
    write_json(DATA, {"dimensions": dims, "clips": clips})
    write_json(INBOX_DATA, {"clips": inbox_clips})

    git("add", "--", "src/data/clips.json", "src/clips")
    if not git("diff", "--cached", "--name-only", "--", "src/data/clips.json", "src/clips"):
        return {"committed": False, "message": "Nothing changed, so nothing was published."}
    added = len(moves)
    summary = f"{added} new clip{'s' if added != 1 else ''}" if added else "clip tags"
    git("commit", "--quiet", "-m", f"chore: publish {summary}", "--", "src/data/clips.json", "src/clips")
    commit = git("rev-parse", "--short", "HEAD")
    push = subprocess.run(["git", "push", "--quiet", "--set-upstream", "origin", branch], cwd=REPO, capture_output=True, text=True)
    if push.returncode != 0:
        return {"committed": True, "pushed": False, "commit": commit,
                "message": f"Committed {commit}, but the push failed: {push.stderr.strip()} Fix it, then push {branch}."}
    if branch == LIVE_BRANCH:
        message = f"Published {summary} ({commit}). The team's page updates in about a minute."
    else:
        message = f"Pushed {summary} to {branch} ({commit}). They go live once {branch} is merged into {LIVE_BRANCH}."
    return {"committed": True, "pushed": True, "commit": commit, "message": message}


def make_handler(port: int):
    allowed_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

        def send_json(self, status: int, payload) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path: Path) -> None:
            if not path.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            size = path.stat().st_size
            start, end = 0, size - 1
            header = self.headers.get("Range", "")
            partial = header.startswith("bytes=") and size > 0
            if partial:  # range requests let the browser seek, and Safari needs them for audio
                first, _, last = header[6:].split(",")[0].partition("-")
                try:
                    if first:
                        start, end = int(first), int(last) if last else end
                    else:
                        start = max(0, size - int(last))
                except ValueError:
                    partial, start, end = False, 0, size - 1
                end = min(end, size - 1)
            length = max(0, end - start + 1)
            self.send_response(HTTPStatus.PARTIAL_CONTENT if partial else HTTPStatus.OK)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-cache")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as f:
                f.seek(start)
                try:
                    self.wfile.write(f.read(length))
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def static(self, base: Path, rel: str) -> None:
            path = (base / unquote(rel)).resolve()
            if not path.is_relative_to(base.resolve()):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_file(path)

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == "/":
                    self.send_file(PAGE / "index.html")
                elif path == "/api/state":
                    self.send_json(HTTPStatus.OK, state())
                elif path.startswith("/triage/"):
                    self.static(PAGE, path[len("/triage/"):])
                elif path.startswith("/clips/"):
                    # Published audio first, then clips still waiting in the inbox: same paths for both.
                    rel = path[1:]
                    site = audio_file(SITE, rel)
                    self.send_file(site if site.is_file() else audio_file(INBOX, rel))
                elif path.startswith(("/assets/", "/data/")):
                    self.static(SITE, path[1:])
                else:
                    self.send_error(HTTPStatus.NOT_FOUND)
            except Refused:
                self.send_error(HTTPStatus.NOT_FOUND)

        def guard(self) -> bool:
            # Only this page may change files: blocks other websites from posting to localhost.
            if self.headers.get("Origin") not in allowed_origins:
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "requests must come from the triage page"})
                return False
            return True

        def body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD:
                raise Refused("file too large")
            return self.rfile.read(length)

        def do_PUT(self):
            if not self.guard():
                return
            url = urlparse(self.path)
            try:
                if url.path != "/api/upload":
                    raise Refused("unknown endpoint", HTTPStatus.NOT_FOUND)
                audio = unquote(url.query.removeprefix("audio=")) if url.query.startswith("audio=") else ""
                target = audio_file(INBOX, audio)
                data = self.body()
                # Never overwrite a different clip: the page picks a free name, so a taken one means the page is
                # out of date. The same bytes again (a retried import) are fine.
                same = {p: digest(p) == hashlib.sha256(data).hexdigest() for p in (target, audio_file(SITE, audio)) if p.exists()}
                if not all(same.values()):
                    raise Refused(f"{unquote(audio)} already exists. Reload the page and import again.", HTTPStatus.CONFLICT)
                if not same:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                self.send_json(HTTPStatus.OK, {"ok": True})
            except Refused as err:
                self.send_json(err.status, {"error": str(err)})

        def do_POST(self):
            if not self.guard():
                return
            path = urlparse(self.path).path
            try:
                payload = json.loads(self.body() or b"{}")
                if path == "/api/inbox":
                    clips = [clean_clip(c) for c in payload.get("clips", [])]
                    for c in clips:
                        audio_file(INBOX, c["audio"])  # validates the path
                    write_json(INBOX_DATA, {"clips": clips})
                    self.send_json(HTTPStatus.OK, {"ok": True})
                elif path == "/api/publish":
                    result = publish(payload)
                    self.send_json(HTTPStatus.OK, {**result, "state": state()})
                else:
                    raise Refused("unknown endpoint", HTTPStatus.NOT_FOUND)
            except json.JSONDecodeError:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "request body is not JSON"})
            except Refused as err:
                self.send_json(err.status, {"error": str(err)})

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--no-browser", action="store_true", help="don't open the page automatically")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.port))
    except OSError:
        print(f"Port {args.port} is busy; the triage page is probably already running. Opening {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    print(f"Triage page: {url}\nClose this window or press Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
