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
import { freeName, safeName, urlPath } from '../triage/naming.mjs';

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
const WAVE = 'wave';                                 // the publish a clip came in with: its date, renamable in the page
const NETWORK_TIMEOUT = 2 * 60 * 1000;              // longest a pull or push may take
// git must never wait for a password in the terminal: the page would hang with no way to answer.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
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
// A name that only starts with two dots, such as ..intro.mp3, is still inside root.
const within = (root, p) => { const rel = path.relative(root, p); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Give every new clip today's wave, and put that wave first in the Wave dimension's order, so the
// board and the gallery list the newest wave first. Clips published before keep their wave.
function stampWave(dims, newClips) {
  if (!newClips.length) return dims;
  const wave = today();
  for (const c of newClips) c[WAVE] = wave;
  const out = dims.map((d) => ({ ...d }));
  let dim = out.find((d) => d.key === WAVE);
  if (!dim) out.push(dim = { key: WAVE, label: 'Wave', defaultSort: true });
  const order = (Array.isArray(dim.order) ? dim.order : []).map(String).filter((v) => v !== wave);
  dim.order = [wave, ...order];
  return out;
}

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

function git(args, { check = true, timeout } = {}) {
  const result = spawnSync('git', args, { cwd: REPO, env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  if (check && result.status !== 0) throw new Refused(`git ${args.join(' ')} failed: ${gitError(result)}`, 409);
  return (result.stdout || '').trim();
}

function gitError(result) {
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return 'it did not finish within 2 minutes. If git needs a password for GitHub, run "git pull" once in a terminal and save it, then try again.';
  }
  return (result.stderr || result.stdout || String(result.error || '')).trim();
}

// True when the remote branch this branch pulls from was deleted (git ls-remote finds no such ref).
function upstreamGone(branch) {
  const remote = git(['config', `branch.${branch}.remote`], { check: false });
  const merge = git(['config', `branch.${branch}.merge`], { check: false });
  if (!remote || !merge) return false;
  const result = spawnSync('git', ['ls-remote', '--exit-code', remote, merge], { cwd: REPO, env: GIT_ENV, encoding: 'utf8', timeout: NETWORK_TIMEOUT });
  return result.status === 2;
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
  // An audio path that is not a valid file path counts as missing, so one bad entry never stops the page loading.
  const audioMissing = (audio) => { try { return !isFile(audioFile(SITE, audio)); } catch { return true; } };
  const missing = (published.clips || []).filter((c) => isLocal(c.audio) && audioMissing(c.audio)).map((c) => c.audio);
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
  if (git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { check: false })) {
    try {
      git(['pull', '--ff-only', '--quiet'], { timeout: NETWORK_TIMEOUT });
    } catch (err) {
      if (err instanceof Refused && upstreamGone(branch)) {
        throw new Refused(`${branch} no longer exists on GitHub, probably because its pull request was merged. Switch to ${LIVE_BRANCH} (git switch ${LIVE_BRANCH} && git pull), reload this page, and publish from there.`, 409);
      }
      throw err;
    }
  }
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

  // Every new clip's audio goes into the commit: moved in from the inbox, or already in src/clips (and
  // then committed with it, in case git does not track it yet). A new clip without audio is refused, so
  // the live page never lists a clip it cannot play. Clips published before are left as they are.
  const oldClips = readJson(DATA, { clips: [] }).clips || [];
  const before = new Set(oldClips.filter((c) => isLocal(c.audio)).map((c) => c.audio));
  const listed = new Set(oldClips.map((c) => c.audio));
  const moves = [];
  const kept = []; // audio of new clips that is already in src/clips
  for (const c of clips) {
    if (!isLocal(c.audio)) continue;
    const siteFile = audioFile(SITE, c.audio);
    const inboxFile = audioFile(INBOX, c.audio);
    if (isFile(inboxFile)) {
      if (fs.existsSync(siteFile)) throw new Refused(`${c.audio} is already in src/clips. Rename the inbox clip and publish again.`, 409);
      moves.push([inboxFile, siteFile]);
    } else if (!before.has(c.audio)) {
      if (!isFile(siteFile)) throw new Refused(`“${c.title}” has no audio file (${c.audio}). Import it again or drop it, then publish again.`, 409);
      kept.push(siteFile);
    }
  }

  // Audio of clips that left the list (dropped in the triage page) is deleted, and git stages the removal.
  const after = new Set(clips.filter((c) => isLocal(c.audio)).map((c) => c.audio));
  const drops = [];
  for (const audio of before) {
    if (after.has(audio)) continue;
    let file;
    try { file = audioFile(SITE, audio); } catch { continue; }
    if (isFile(file)) drops.push(file);
  }

  // Only the files this publish touches are staged and committed, so nothing else under src/clips
  // goes live by accident. A dropped file git never tracked has nothing to stage.
  const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');
  const tracked = new Set(drops.length ? git(['ls-files', '-z', '--', ...drops.map(rel)]).split('\0').filter(Boolean) : []);
  const paths = ['--', rel(DATA), ...moves.map(([, dest]) => rel(dest)), ...kept.map(rel), ...drops.map(rel).filter((p) => tracked.has(p))];

  // Everything below is undone if a step fails before the commit lands, so a failed publish
  // (a git hook, no git identity) leaves the inbox, src/clips and clips.json as they were.
  const oldData = fs.readFileSync(DATA);
  const oldInbox = fs.existsSync(INBOX_DATA) ? fs.readFileSync(INBOX_DATA) : null;
  const trash = path.join(INBOX, '.publish-trash');
  const done = { moved: [], trashed: [], staged: false };
  let summary;
  let commit;
  try {
    for (const [src, dest] of moves) { moveFile(src, dest); done.moved.push([src, dest]); }
    fs.rmSync(trash, { recursive: true, force: true });
    for (const [i, file] of drops.entries()) {
      const kept = path.join(trash, String(i));
      moveFile(file, kept);
      done.trashed.push([kept, file]);
    }
    const declared = (published.dimensions || []).filter((d) => d && typeof d === 'object' && d.key);
    const dims = stampWave(declared, clips.filter((c) => !listed.has(c.audio)));
    writeJson(DATA, { dimensions: dims, clips });
    writeJson(INBOX_DATA, { clips: inboxClips });

    done.staged = true;
    git(['add', '-A', ...paths]);
    if (!git(['diff', '--cached', '--name-only', ...paths])) {
      fs.rmSync(trash, { recursive: true, force: true });
      return { committed: false, message: 'Nothing changed, so nothing was published.' };
    }
    const parts = [];
    if (moves.length + kept.length) parts.push(plural(moves.length + kept.length, 'new clip'));
    if (drops.length) parts.push(plural(drops.length, 'removed clip'));
    summary = parts.join(', ') || 'clip tags';
    git(['commit', '--quiet', '-m', `chore: publish ${summary}`, ...paths]);
    commit = git(['rev-parse', '--short', 'HEAD']);
  } catch (err) {
    if (done.staged) git(['reset', '--quiet', ...paths], { check: false });
    fs.writeFileSync(DATA, oldData);
    if (oldInbox) fs.writeFileSync(INBOX_DATA, oldInbox);
    else fs.rmSync(INBOX_DATA, { force: true });
    for (const [kept, file] of done.trashed.reverse()) moveFile(kept, file);
    for (const [src, dest] of done.moved.reverse()) moveFile(dest, src);
    fs.rmSync(trash, { recursive: true, force: true });
    if (err instanceof Refused) err.message = `Nothing was published, and your clips are as they were. ${err.message}`;
    throw err;
  }
  fs.rmSync(trash, { recursive: true, force: true });
  const emptied = [...new Set(moves.map(([src]) => path.dirname(src)))].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (let dir of emptied) {
    while (dir !== INBOX && within(INBOX, dir) && isDir(dir) && !fs.readdirSync(dir).length) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  const push = spawnSync('git', ['push', '--quiet', '--set-upstream', 'origin', branch], { cwd: REPO, env: GIT_ENV, encoding: 'utf8', timeout: NETWORK_TIMEOUT });
  if (push.status !== 0) {
    return { committed: true, pushed: false, commit, message: `Committed ${commit}, but the push failed: ${gitError(push)} Fix it, then push ${branch}.` };
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
    if (partial && start > end) { // starts past the end of the file, or asks for none of it
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
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
    // Too large a body is read to the end and thrown away, not cut off: closing the connection early
    // would lose the 413 reply, and the page would show a network error instead of the reason.
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_UPLOAD) chunks.push(chunk);
      else chunks.length = 0;
    });
    req.on('end', () => (size > MAX_UPLOAD ? reject(new Refused('file too large', 413)) : resolve(Buffer.concat(chunks))));
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
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  return http.createServer(async (req, res) => {
    // Only answer requests addressed to this computer: blocks a website that points its own name at
    // 127.0.0.1 (DNS rebinding) from reading the inbox.
    if (!allowedHosts.has(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Open the triage page at http://127.0.0.1:' + port + '/');
      return;
    }
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
    const safe = safeName(path.basename(old));
    if (safe === path.basename(old) || !isFile(old)) continue;
    const dir = path.dirname(old);
    const key = (name) => `clips/${path.relative(path.join(INBOX, 'clips'), path.join(dir, name)).split(path.sep).join('/')}`.toLowerCase();
    const name = freeName(safe, (n) => taken.has(key(n)) || fs.existsSync(path.join(dir, n)));
    const renamedTo = path.join(dir, name);
    fs.renameSync(old, renamedTo);
    taken.add(key(name));
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
