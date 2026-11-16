// Local triage page: import exported clips, tag them, and publish them to GitHub Pages.
//
// Usage:
//     node scripts/triage.mjs [--port 8770] [--no-browser]
//
// Or `npm run triage`. The page opens in your browser; press Ctrl+C (or close the terminal window)
// to stop it.
//
// Imported clips wait in inbox/ (ignored by git, so they stay on this computer) until they have a
// source game and a use case. Publish then moves them into src/clips/ and src/data/clips.json,
// commits those two paths on the checked-out branch, and pushes it. On main that updates the GitHub
// Pages site; on any other branch the clips go live once that branch is merged into main.
//
// Needs only Node.js and git; it uses no packages.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(REPO, 'src');                 // the published site
const PAGE = path.join(REPO, 'triage');              // the triage page's own files
const INBOX = path.join(REPO, 'inbox');              // imported clips not published yet (git-ignored)
const DATA = path.join(SITE, 'data', 'clips.json');
const INBOX_DATA = path.join(INBOX, 'clips.json');
const LIVE_BRANCH = 'main';                          // the branch GitHub Pages publishes
const AUDIO_SUFFIXES = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);
const MAX_UPLOAD = 200 * 1024 * 1024;
const IMPORT_FOLDER = 'import-folder';               // inbox-only field: the export folder a clip came from

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'audio/webm',
};

/** A request the page should show as an error message. */
class Refused extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const within = (root, p) => { const rel = path.relative(root, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A file path as a URL path: %, # and ? would otherwise be read as an escape, a fragment or a query.
const urlPath = (s) => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');

function unquote(s) {
  try { return decodeURIComponent(s); } catch { throw new Refused(`not a valid URL path: ${JSON.stringify(s)}`); }
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file.replace(/\.json$/, '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : '');

// Every file under dir, as paths relative to dir with forward slashes.
function walk(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map((rel) => rel.split(path.sep).join('/')).sort();
}

const hashCache = new Map(); // absolute path -> [size, mtimeNs, hash]

// SHA-256 of every audio file under src/clips/ and inbox/clips/, keyed by its `audio` value.
// The page uses them to spot an export file that is already in the gallery under any name, and to
// see which file names are taken. Hashes are cached by size and modification time.
function audioHashes() {
  const out = {};
  for (const base of [SITE, INBOX]) {
    const root = path.join(base, 'clips');
    for (const rel of walk(root)) {
      const file = path.join(root, rel);
      const name = path.basename(file);
      if (name.startsWith('.') || !AUDIO_SUFFIXES.has(path.extname(name).toLowerCase())) continue;
      const st = fs.statSync(file, { bigint: true });
      if (!st.isFile()) continue;
      let cached = hashCache.get(file);
      if (!cached || cached[0] !== st.size || cached[1] !== st.mtimeNs) {
        cached = [st.size, st.mtimeNs, digest(file)];
        hashCache.set(file, cached);
      }
      const key = urlPath(`clips/${rel}`);
      if (!(key in out)) out[key] = cached[2];
    }
  }
  return out;
}

// Map a clip's `audio` value (a URL path such as clips/game/a%23b.mp3) to a file under base.
function audioFile(base, audio) {
  if (typeof audio !== 'string' || !audio.startsWith('clips/')) throw new Refused(`audio must start with clips/: ${JSON.stringify(audio)}`);
  const file = path.resolve(base, unquote(audio));
  if (!within(path.join(base, 'clips'), file) || !AUDIO_SUFFIXES.has(path.extname(file).toLowerCase())) {
    throw new Refused(`not an audio path under clips/: ${JSON.stringify(audio)}`);
  }
  return file;
}

const isLocal = (audio) => typeof audio === 'string' && audio.startsWith('clips/');

function git(args, { check = true } = {}) {
  const result = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (check && result.status !== 0) {
    throw new Refused(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || String(result.error || '')).trim()}`, 409);
  }
  return (result.stdout || '').trim();
}

// GitHub link for opening a pull request from branch into main, or "" if origin is not on GitHub.
function compareUrl(branch) {
  const url = git(['remote', 'get-url', 'origin'], { check: false });
  for (const prefix of ['https://github.com/', 'git@github.com:', 'ssh://git@github.com/']) {
    if (url.startsWith(prefix)) {
      const repo = url.slice(prefix.length).replace(/\/$/, '').replace(/\.git$/, '');
      return `https://github.com/${repo}/compare/${LIVE_BRANCH}...${encodeURIComponent(branch).replace(/%2F/g, '/')}?expand=1`;
    }
  }
  return '';
}

function cleanClip(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.title !== 'string' || !c.title.trim()) {
    throw new Refused('every clip needs a title');
  }
  if (typeof c.audio !== 'string') throw new Refused(`clip ${JSON.stringify(c.title)} needs an audio path`);
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
}

function state() {
  const published = readJson(DATA, { dimensions: [], clips: [] });
  const inbox = readJson(INBOX_DATA, { clips: [] });
  const missing = (published.clips || []).filter((c) => isLocal(c.audio) && !isFile(audioFile(SITE, c.audio))).map((c) => c.audio);
  const branch = git(['branch', '--show-current'], { check: false });
  return {
    published,
    inbox,
    missing,
    hashes: audioHashes(),
    version: digest(DATA),
    branch,
    canPublish: Boolean(branch),
    liveBranch: LIVE_BRANCH,
    compareUrl: branch && branch !== LIVE_BRANCH ? compareUrl(branch) : '',
  };
}

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// Write the edited published list, move newly published audio out of the inbox, commit and push the current branch.
function publish(body) {
  const branch = git(['branch', '--show-current']);
  if (!branch) throw new Refused('Publishing needs a branch checked out; this checkout is not on a branch.', 409);
  if (body.version !== digest(DATA)) throw new Refused('src/data/clips.json changed since the page loaded. Reload the page and try again.', 409);
  if (git(['status', '--porcelain', '--', 'src/data/clips.json'])) {
    throw new Refused('src/data/clips.json has uncommitted changes. Commit or discard them first.', 409);
  }

  // Bring the branch up to date first, so the push is a fast-forward. A branch never pushed has nothing to pull.
  if (git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { check: false })) git(['pull', '--ff-only', '--quiet']);
  if (body.version !== digest(DATA)) throw new Refused('GitHub had newer clips. Reload the page to see them, then publish again.', 409);

  const published = body.published || {};
  const clips = (published.clips || []).map(cleanClip);
  for (const c of clips) delete c[IMPORT_FOLDER]; // where a clip was imported from only matters while it waits in the inbox
  const inboxClips = ((body.inbox || {}).clips || []).map(cleanClip);
  const seen = new Set();
  for (const c of [...clips, ...inboxClips]) {
    if (seen.has(c.audio)) throw new Refused(`two clips use the same audio file: ${c.audio}`);
    seen.add(c.audio);
  }

  const moves = [];
  for (const c of clips) {
    if (!isLocal(c.audio)) continue;
    const siteFile = audioFile(SITE, c.audio);
    const inboxFile = audioFile(INBOX, c.audio);
    if (isFile(inboxFile)) moves.push([inboxFile, siteFile]);
  }
  for (const [src, dest] of moves) moveFile(src, dest);
  const emptied = [...new Set(moves.map(([src]) => path.dirname(src)))].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (let dir of emptied) {
    while (dir !== INBOX && within(INBOX, dir) && isDir(dir) && !fs.readdirSync(dir).length) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }

  // Audio of clips that left the list (dropped in the triage page) is deleted, and git stages the removal.
  const before = new Set((readJson(DATA, { clips: [] }).clips || []).filter((c) => isLocal(c.audio)).map((c) => c.audio));
  const after = new Set(clips.filter((c) => isLocal(c.audio)).map((c) => c.audio));
  let dropped = 0;
  for (const audio of before) {
    if (after.has(audio)) continue;
    let file;
    try { file = audioFile(SITE, audio); } catch { continue; }
    if (isFile(file)) {
      fs.unlinkSync(file);
      dropped++;
    }
  }

  const dims = (published.dimensions || []).filter((d) => d && typeof d === 'object' && d.key);
  writeJson(DATA, { dimensions: dims, clips });
  writeJson(INBOX_DATA, { clips: inboxClips });

  git(['add', '--', 'src/data/clips.json', 'src/clips']);
  if (!git(['diff', '--cached', '--name-only', '--', 'src/data/clips.json', 'src/clips'])) {
    return { committed: false, message: 'Nothing changed, so nothing was published.' };
  }
  const parts = [];
  if (moves.length) parts.push(plural(moves.length, 'new clip'));
  if (dropped) parts.push(plural(dropped, 'removed clip'));
  const summary = parts.join(', ') || 'clip tags';
  git(['commit', '--quiet', '-m', `chore: publish ${summary}`, '--', 'src/data/clips.json', 'src/clips']);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const push = spawnSync('git', ['push', '--quiet', '--set-upstream', 'origin', branch], { cwd: REPO, encoding: 'utf8' });
  if (push.status !== 0) {
    return { committed: true, pushed: false, commit, message: `Committed ${commit}, but the push failed: ${(push.stderr || '').trim()} Fix it, then push ${branch}.` };
  }
  const message = branch === LIVE_BRANCH
    ? `Published ${summary} (${commit}). The team's page updates in about a minute.`
    : `Pushed ${summary} to ${branch} (${commit}). They go live once ${branch} is merged into ${LIVE_BRANCH}.`;
  return { committed: true, pushed: true, commit, message };
}

// ---------- HTTP ----------

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function sendFile(req, res, file) {
  if (!isFile(file)) return notFound(res);
  const size = fs.statSync(file).size;
  let start = 0;
  let end = size - 1;
  const header = req.headers.range || '';
  let partial = header.startsWith('bytes=') && size > 0;
  if (partial) { // range requests let the browser seek, and Safari needs them for audio
    const [first, last = ''] = header.slice(6).split(',')[0].split('-');
    const num = (s) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
    if (first.trim()) {
      start = num(first);
      end = last.trim() ? num(last) : end;
    } else {
      start = Math.max(0, size - num(last));
    }
    if (Number.isNaN(start) || Number.isNaN(end)) { partial = false; start = 0; end = size - 1; }
    end = Math.min(end, size - 1);
  }
  const length = Math.max(0, end - start + 1);
  const headers = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': length,
    'Cache-Control': 'no-cache',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, headers);
  if (!length) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function sendStatic(req, res, base, rel) {
  const file = path.resolve(base, unquote(rel));
  if (!within(base, file)) return notFound(res);
  sendFile(req, res, file);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        reject(new Refused('file too large', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function handleGet(req, res, pathname) {
  if (pathname === '/') return sendFile(req, res, path.join(PAGE, 'index.html'));
  if (pathname === '/api/state') return sendJson(res, 200, state());
  if (pathname.startsWith('/triage/')) return sendStatic(req, res, PAGE, pathname.slice('/triage/'.length));
  if (pathname.startsWith('/clips/')) {
    // Published audio first, then clips still waiting in the inbox: same paths for both.
    const rel = pathname.slice(1);
    const site = audioFile(SITE, rel);
    return sendFile(req, res, isFile(site) ? site : audioFile(INBOX, rel));
  }
  if (pathname === '/gallery') {
    res.writeHead(301, { Location: '/gallery/' });
    return res.end();
  }
  if (pathname.startsWith('/gallery/')) {
    // The team's page as published from this checkout: src/ only, no inbox clips.
    return sendStatic(req, res, SITE, pathname.slice('/gallery/'.length) || 'index.html');
  }
  if (pathname.startsWith('/assets/') || pathname.startsWith('/data/')) return sendStatic(req, res, SITE, pathname.slice(1));
  return notFound(res);
}

async function handleWrite(req, res, url) {
  if (url.pathname === '/api/upload' && req.method === 'PUT') {
    const query = url.search.slice(1);
    const audio = query.startsWith('audio=') ? unquote(query.slice('audio='.length)) : '';
    const target = audioFile(INBOX, audio);
    const data = await readBody(req);
    // Never overwrite a different clip: the page picks a free name, so a taken one means the page is
    // out of date. The same bytes again (a retried import) are fine.
    const hash = sha256(data);
    const existing = [target, audioFile(SITE, audio)].filter((p) => fs.existsSync(p));
    if (existing.some((p) => digest(p) !== hash)) throw new Refused(`${unquote(audio)} already exists. Reload the page and import again.`, 409);
    if (!existing.length) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (url.pathname === '/api/inbox' || url.pathname === '/api/publish')) {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch (err) {
      if (err instanceof Refused) throw err;
      return sendJson(res, 400, { error: 'request body is not JSON' });
    }
    if (url.pathname === '/api/inbox') {
      const clips = (payload.clips || []).map(cleanClip);
      for (const c of clips) audioFile(INBOX, c.audio); // validates the path
      writeJson(INBOX_DATA, { clips });
      return sendJson(res, 200, { ok: true });
    }
    const result = publish(payload);
    return sendJson(res, 200, { ...result, state: state() });
  }
  throw new Refused('unknown endpoint', 404);
}

function makeServer(port) {
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET') {
      try {
        handleGet(req, res, url.pathname);
      } catch (err) {
        if (!(err instanceof Refused)) console.error(err);
        if (!res.headersSent) notFound(res);
      }
      return;
    }
    if (req.method !== 'PUT' && req.method !== 'POST') {
      res.writeHead(501);
      res.end();
      return;
    }
    // Only this page may change files: blocks other websites from posting to localhost.
    if (!allowedOrigins.has(req.headers.origin)) {
      sendJson(res, 403, { error: 'requests must come from the triage page' });
      return;
    }
    try {
      await handleWrite(req, res, url);
    } catch (err) {
      if (!(err instanceof Refused)) console.error(err);
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    }
  });
}

// Characters that have a meaning in URLs. Some browsers fail to play a file whose name has them even
// when they are escaped, so stored file names use the full-width look-alikes instead.
const urlSafe = (s) => s.replace(/\?/g, '？').replace(/#/g, '＃').replace(/%/g, '％');

// Rename inbox audio files whose names contain ?, # or %, and update their clips. Returns how many.
function renameUnsafeInboxFiles() {
  const data = readJson(INBOX_DATA, { clips: [] });
  const clips = data.clips || [];
  const taken = new Set([SITE, INBOX].flatMap((base) => walk(path.join(base, 'clips')).map((rel) => `clips/${rel}`.toLowerCase())));
  let renamed = 0;
  for (const c of clips) {
    if (!isLocal(c.audio)) continue;
    let old;
    try { old = audioFile(INBOX, c.audio); } catch { continue; }
    const safe = urlSafe(path.basename(old));
    if (safe === path.basename(old) || !isFile(old)) continue;
    const dot = safe.lastIndexOf('.');
    const [stem, suffix] = [safe.slice(0, dot), safe.slice(dot)];
    let name = safe;
    for (let n = 2; taken.has(`clips/${name}`.toLowerCase()); n++) name = `${stem}-${n}${suffix}`;
    const renamedTo = path.join(path.dirname(old), name);
    fs.renameSync(old, renamedTo);
    taken.add(`clips/${name}`.toLowerCase());
    const rel = path.relative(path.join(INBOX, 'clips'), renamedTo).split(path.sep).join('/');
    c.audio = urlPath(`clips/${rel}`);
    renamed++;
  }
  if (renamed) writeJson(INBOX_DATA, { ...data, clips });
  return renamed;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node scripts/triage.mjs [--port 8770] [--no-browser]');
    return;
  }
  const at = args.indexOf('--port');
  const port = at >= 0 ? Number(args[at + 1]) : 8770;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('--port needs a number between 1 and 65535');
    process.exitCode = 2;
    return;
  }
  const noBrowser = args.includes('--no-browser');
  const url = `http://127.0.0.1:${port}/`;
  const server = makeServer(port);
  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.log(`Port ${port} is busy; the triage page is probably already running. Opening ${url}`);
    if (!noBrowser) openBrowser(url);
  });
  server.listen(port, '127.0.0.1', () => {
    const n = renameUnsafeInboxFiles();
    if (n) console.log(`Renamed ${n} inbox file(s) whose names had ?, # or % in them.`);
    console.log(`Triage page: ${url}\nClose this window or press Ctrl+C to stop.`);
    if (!noBrowser) openBrowser(url);
  });
}

main();
