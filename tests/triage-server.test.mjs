// Regression tests for the local triage server (scripts/triage.mjs).
//
// Each run builds a throwaway copy of the project in a temporary folder: a git repository on a work
// branch with a local bare repository as its remote, a few published clips and a few inbox clips.
// It starts the real server there and talks to it over HTTP, so nothing touches this checkout.
//
// Run with `npm test`. Needs only Node.js and git.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'feat/test';

let tmp; // the throwaway project
let remote; // its bare remote
let server; // the running server process
let port;
let base; // http://127.0.0.1:<port>
let origin; // the Origin the server accepts
let startupLog = '';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (...parts) => path.join(tmp, ...parts);
const readJson = (...parts) => JSON.parse(fs.readFileSync(file(...parts), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' }).trim();
const audio = (size = 4000) => randomBytes(size);
const enc = (name) => encodeURIComponent(name); // a clip's audio value as a query parameter
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Fixture audio. The names cover full-width look-alikes, URL characters and a clash with a free name.
const AUDIO = {
  published: audio(),        // src/clips/grunt.mp3, a published clip
  publishedOld: audio(),     // src/clips/old.mp3, a published clip that Publish drops
  question: audio(33433),    // inbox file "0602_0029_(?????).mp3"
  hash: audio(),             // inbox file "a#b.mp3"
  clash: audio(),            // inbox file "x?.mp3", whose safe name "x？.mp3" is already taken
  taken: audio(),            // inbox file "x？.mp3"
  dropped: audio(),          // inbox file "plain.mp3", dropped
  subClash: audio(),         // inbox file "sub/c#d.mp3", whose safe name "sub/c＃d.mp3" is already taken
  subTaken: audio(),         // inbox file "sub/c＃d.mp3"
};

function writeJson(rel, data) {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), JSON.stringify(data, null, 2) + '\n');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });
}

// A GET with the path sent exactly as written (fetch would normalise "..").
function rawGet(rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const get = (p, headers) => fetch(base + p, { headers, redirect: 'manual' });
const send = (method, p, body, { json = true, from = origin } = {}) => fetch(base + p, {
  method,
  headers: { ...(from ? { Origin: from } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
  body: json ? JSON.stringify(body) : body,
});
const state = async () => (await get('/api/state')).json();

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-test-'));
  remote = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-remote-'));

  // The server and the pages it serves, copied from this checkout.
  fs.mkdirSync(file('scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'triage.mjs'), file('scripts', 'triage.mjs'));
  fs.cpSync(path.join(ROOT, 'triage'), file('triage'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'src', 'assets'), file('src', 'assets'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'index.html'), file('src', 'index.html'));
  fs.writeFileSync(file('.gitignore'), 'inbox/\n');

  // Published: two clips with audio, one without.
  fs.mkdirSync(file('src', 'clips'), { recursive: true });
  fs.writeFileSync(file('src', 'clips', 'grunt.mp3'), AUDIO.published);
  fs.writeFileSync(file('src', 'clips', 'old.mp3'), AUDIO.publishedOld);
  writeJson('src/data/clips.json', {
    dimensions: [{ key: 'use-case', label: 'Use case' }, { key: 'source-game', label: 'Source game' }],
    clips: [
      { title: 'Grunt', audio: 'clips/grunt.mp3', 'source-game': 'A', 'use-case': 'Hurt' },
      { title: 'Old', audio: 'clips/old.mp3', 'source-game': 'A', 'use-case': 'Hurt' },
      { title: 'Gone', audio: 'clips/gone.mp3', 'source-game': 'A', 'use-case': 'Hurt' },
    ],
  });

  // Inbox: clips imported before ?, # and % were kept out of file names.
  fs.mkdirSync(file('inbox', 'clips'), { recursive: true });
  fs.writeFileSync(file('inbox', 'clips', '0602_0029_(?????).mp3'), AUDIO.question);
  fs.writeFileSync(file('inbox', 'clips', 'a#b.mp3'), AUDIO.hash);
  fs.writeFileSync(file('inbox', 'clips', 'x?.mp3'), AUDIO.clash);
  fs.writeFileSync(file('inbox', 'clips', 'x？.mp3'), AUDIO.taken);
  fs.writeFileSync(file('inbox', 'clips', 'plain.mp3'), AUDIO.dropped);
  fs.mkdirSync(file('inbox', 'clips', 'sub'));
  fs.writeFileSync(file('inbox', 'clips', 'sub', 'c#d.mp3'), AUDIO.subClash);
  fs.writeFileSync(file('inbox', 'clips', 'sub', 'c＃d.mp3'), AUDIO.subTaken);
  writeJson('inbox/clips.json', {
    clips: [
      { title: '(?????)', audio: 'clips/0602_0029_(%3F%3F%3F%3F%3F).mp3', 'import-folder': 'export/', recording: '0602', 'source-game': 'B', 'use-case': 'Victory' },
      { title: 'a#b', audio: 'clips/a%23b.mp3', 'source-game': 'B' },
      { title: 'x?', audio: 'clips/x%3F.mp3' },
      { title: 'x？', audio: 'clips/x？.mp3' },
      { title: 'plain', audio: 'clips/plain.mp3', dropped: true },
      { title: 'c#d', audio: 'clips/sub/c%23d.mp3' },
      { title: 'c＃d', audio: 'clips/sub/c＃d.mp3' },
    ],
  });

  execFileSync('git', ['init', '--quiet', '--bare', remote]);
  execFileSync('git', ['init', '--quiet', '-b', BRANCH], { cwd: tmp });
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'fixture');
  git('remote', 'add', 'origin', remote);
  git('push', '--quiet', '--set-upstream', 'origin', BRANCH);

  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  origin = base;
  server = spawn(process.execPath, ['scripts/triage.mjs', '--port', String(port), '--no-browser'], { cwd: tmp });
  server.stderr.on('data', (d) => { startupLog += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${startupLog}`)), 10000);
    server.stdout.on('data', (d) => {
      startupLog += d;
      if (startupLog.includes('Triage page:')) { clearTimeout(timer); resolve(); }
    });
    server.on('exit', (code) => reject(new Error(`server exited with ${code}:\n${startupLog}`)));
  });
});

after(() => {
  server?.kill();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  if (remote) fs.rmSync(remote, { recursive: true, force: true });
});

describe('start-up', () => {
  test('renames inbox files whose names have ?, # or % and updates their clips', () => {
    assert.match(startupLog, /Renamed 4 inbox file\(s\)/);
    const names = fs.readdirSync(file('inbox', 'clips'), { recursive: true }).map((n) => n.split(path.sep).join('/')).sort();
    assert.deepEqual(names, ['0602_0029_(？？？？？).mp3', 'a＃b.mp3', 'plain.mp3', 'sub', 'sub/c＃d-2.mp3', 'sub/c＃d.mp3', 'x？-2.mp3', 'x？.mp3'].sort());
    const clips = readJson('inbox', 'clips.json').clips;
    assert.deepEqual(clips.map((c) => c.audio), [
      'clips/0602_0029_(？？？？？).mp3', 'clips/a＃b.mp3', 'clips/x？-2.mp3', 'clips/x？.mp3', 'clips/plain.mp3', 'clips/sub/c＃d-2.mp3', 'clips/sub/c＃d.mp3',
    ]);
    assert.equal(clips[0].title, '(?????)', 'the title keeps the original characters');
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', 'x？-2.mp3')), AUDIO.clash, 'a taken safe name gets -2');
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', 'x？.mp3')), AUDIO.taken, 'the file that had the name is untouched');
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', 'sub', 'c＃d-2.mp3')), AUDIO.subClash, 'a taken name in a subfolder gets -2 too');
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', 'sub', 'c＃d.mp3')), AUDIO.subTaken, 'and the subfolder file that had the name is untouched');
  });
});

describe('GET /api/state', () => {
  test('reports the published list, the inbox, missing audio, hashes and the branch', async () => {
    const s = await state();
    assert.equal(s.published.clips.length, 3);
    assert.equal(s.inbox.clips.length, 7);
    assert.deepEqual(s.missing, ['clips/gone.mp3']);
    assert.equal(s.version, sha(fs.readFileSync(file('src', 'data', 'clips.json'))));
    assert.equal(s.branch, BRANCH);
    assert.equal(s.canPublish, true);
    assert.equal(s.liveBranch, 'main');
    assert.equal(s.compareUrl, '', 'origin is not on GitHub');
    assert.equal(s.hashes['clips/grunt.mp3'], sha(AUDIO.published));
    assert.equal(s.hashes['clips/0602_0029_(？？？？？).mp3'], sha(AUDIO.question));
    assert.equal(Object.keys(s.hashes).length, 9);
  });
});

describe('GET /api/state with a bad audio path', () => {
  test('counts the clip as missing instead of failing to load', async () => {
    const before = fs.readFileSync(file('src', 'data', 'clips.json'));
    const data = JSON.parse(before);
    writeJson('src/data/clips.json', { ...data, clips: [...data.clips, { title: 'Notes', audio: 'clips/notes.txt' }, { title: 'Bad escape', audio: 'clips/100%.mp3' }] });
    try {
      const res = await get('/api/state');
      assert.equal(res.status, 200);
      const s = await res.json();
      assert.deepEqual(s.missing, ['clips/gone.mp3', 'clips/notes.txt', 'clips/100%.mp3']);
    } finally {
      fs.writeFileSync(file('src', 'data', 'clips.json'), before);
    }
  });
});

describe('static files', () => {
  for (const [p, type] of [
    ['/', 'text/html'],
    ['/triage/triage.js', 'text/javascript'],
    ['/triage/triage.css', 'text/css'],
    ['/assets/app.js', 'text/javascript'],
    ['/data/clips.json', 'application/json'],
    ['/gallery/', 'text/html'],
    ['/gallery/assets/style.css', 'text/css'],
    ['/gallery/data/clips.json', 'application/json'],
  ]) {
    test(`serves ${p}`, async () => {
      const res = await get(p);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').startsWith(type), res.headers.get('content-type'));
    });
  }

  test('redirects /gallery to /gallery/', async () => {
    const res = await get('/gallery');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/gallery/');
  });

  test('the gallery shows published audio only, not the inbox', async () => {
    assert.equal((await get('/gallery/clips/grunt.mp3')).status, 200);
    assert.equal((await get(`/gallery/clips/${enc('a＃b.mp3')}`)).status, 404);
  });

  for (const p of [
    '/clips/../scripts/triage.mjs',
    '/triage/../scripts/triage.mjs',
    '/triage/%2e%2e/scripts/triage.mjs',
    '/gallery/..%2fscripts/triage.mjs',
    '/triage/..%2fscripts/triage.mjs',
    '/assets/..%2f..%2finbox/clips.json',
    '/clips/%E0%A4%A.mp3',
    '/scripts/triage.mjs',
    '/inbox/clips.json',
    '/nope',
  ]) {
    test(`refuses ${p}`, async () => {
      assert.equal((await rawGet(p)).status, 404);
    });
  }
});

describe('audio', () => {
  const question = `/clips/${enc('0602_0029_(？？？？？).mp3')}`;

  test('serves an inbox clip under its full-width name', async () => {
    const res = await get(question);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO.question);
  });

  test('serves a published clip at the same kind of path', async () => {
    const res = await get('/clips/grunt.mp3');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO.published);
  });

  for (const [range, start, end] of [['bytes=100-199', 100, 199], ['bytes=-50', 33383, 33432], ['bytes=33000-', 33000, 33432], ['bytes=33400-99999', 33400, 33432]]) {
    test(`answers Range: ${range} (Safari needs ranges for audio)`, async () => {
      const res = await get(question, { Range: range });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/33433`);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO.question.subarray(start, end + 1));
    });
  }

  for (const range of ['bytes=33433-', 'bytes=99999-100000', 'bytes=-0']) {
    test(`answers 416 to Range: ${range}, which asks for nothing in the file`, async () => {
      const res = await get(question, { Range: range });
      assert.equal(res.status, 416);
      assert.equal(res.headers.get('content-range'), 'bytes */33433');
    });
  }

  test('ignores a Range it cannot read', async () => {
    const res = await get(question, { Range: 'bytes=abc-def' });
    assert.equal(res.status, 200);
    assert.equal(Number(res.headers.get('content-length')), 33433);
  });
});

describe('requests must be addressed to this computer', () => {
  for (const host of ['evil.example', `evil.example:${0}`]) {
    test(`a request with Host: ${host} is refused (DNS rebinding)`, async () => {
      const res = await rawGet('/api/state', { Host: host.replace(':0', `:${port}`) });
      assert.equal(res.status, 403);
      assert.ok(!res.body.toString().includes('clips'));
    });
  }

  test('localhost works as well as 127.0.0.1', async () => {
    assert.equal((await rawGet('/api/state', { Host: `localhost:${port}` })).status, 200);
  });
});

describe('writes need the triage page', () => {
  test('a request without an Origin is refused', async () => {
    assert.equal((await send('POST', '/api/inbox', { clips: [] }, { from: null })).status, 403);
  });

  test('a request from another website is refused', async () => {
    assert.equal((await send('POST', '/api/inbox', { clips: [] }, { from: 'https://example.com' })).status, 403);
    assert.equal((await send('PUT', `/api/upload?audio=${enc('clips/evil.mp3')}`, audio(), { json: false, from: 'https://example.com' })).status, 403);
    assert.ok(!fs.existsSync(file('inbox', 'clips', 'evil.mp3')));
  });
});

describe('PUT /api/upload', () => {
  const name = 'new％clip.mp3';
  const bytes = audio();
  const upload = (audioValue, body) => send('PUT', `/api/upload?audio=${enc(audioValue)}`, body, { json: false });

  test('stores a new file in the inbox', async () => {
    const res = await upload(`clips/${name}`, bytes);
    assert.equal(res.status, 200);
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', name)), bytes);
  });

  test('accepts the same bytes again (a retried import)', async () => {
    assert.equal((await upload(`clips/${name}`, bytes)).status, 200);
  });

  test('never overwrites a different file in the inbox', async () => {
    const res = await upload(`clips/${name}`, audio());
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already exists/);
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', name)), bytes);
  });

  test('never shadows a published file with different bytes', async () => {
    assert.equal((await upload('clips/grunt.mp3', audio())).status, 409);
    assert.ok(!fs.existsSync(file('inbox', 'clips', 'grunt.mp3')));
  });

  for (const [label, value] of [
    ['a path outside clips/', 'clips/../../evil.mp3'],
    ['a path not under clips/', 'src/evil.mp3'],
    ['a file that is not audio', 'clips/notes.txt'],
  ]) {
    test(`refuses ${label}`, async () => {
      assert.equal((await upload(value, audio())).status, 400);
    });
  }

  test('stores a file whose name starts with two dots', async () => {
    const dots = audio();
    assert.equal((await upload('clips/..intro.mp3', dots)).status, 200);
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', '..intro.mp3')), dots);
    fs.rmSync(file('inbox', 'clips', '..intro.mp3'));
  });

  test('says a file is too large, rather than dropping the connection', async () => {
    const res = await upload('clips/huge.mp3', Buffer.alloc(200 * 1024 * 1024 + 1));
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, /too large/);
    assert.ok(!fs.existsSync(file('inbox', 'clips', 'huge.mp3')));
  });

  test('refuses a malformed escape', async () => {
    assert.equal((await send('PUT', '/api/upload?audio=%E0%A4%A', audio(), { json: false })).status, 400);
  });

  test('refuses an unknown endpoint', async () => {
    assert.equal((await send('PUT', '/api/other', audio(), { json: false })).status, 404);
  });
});

describe('POST /api/inbox', () => {
  test('saves the inbox in the same JSON format as before and drops empty fields', async () => {
    const before = readJson('inbox', 'clips.json');
    const clips = before.clips.map((c) => ({ ...c }));
    clips[1].note = '';
    clips[1].tags = [];
    clips[1].other = null;
    const res = await send('POST', '/api/inbox', { clips });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(file('inbox', 'clips.json'), 'utf8'), JSON.stringify(before, null, 2) + '\n');
  });

  test('keeps non-ASCII titles as they are', () => {
    assert.ok(fs.readFileSync(file('inbox', 'clips.json'), 'utf8').includes('"(?????)"'));
    assert.ok(fs.readFileSync(file('inbox', 'clips.json'), 'utf8').includes('？？？？？'));
  });

  for (const [label, clip] of [
    ['a clip without a title', { audio: 'clips/a.mp3' }],
    ['a clip with a blank title', { title: '  ', audio: 'clips/a.mp3' }],
    ['a clip without audio', { title: 'a' }],
    ['a clip with audio outside clips/', { title: 'a', audio: 'clips/../x.mp3' }],
  ]) {
    test(`refuses ${label} and leaves the inbox alone`, async () => {
      const before = fs.readFileSync(file('inbox', 'clips.json'), 'utf8');
      assert.equal((await send('POST', '/api/inbox', { clips: [clip] })).status, 400);
      assert.equal(fs.readFileSync(file('inbox', 'clips.json'), 'utf8'), before);
    });
  }

  test('refuses a body that is not JSON', async () => {
    const res = await send('POST', '/api/inbox', 'not json', { json: false });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'request body is not JSON');
  });
});

describe('POST /api/publish', () => {
  test('refuses when clips.json changed since the page loaded', async () => {
    const s = await state();
    const res = await send('POST', '/api/publish', { version: 'stale', published: s.published, inbox: s.inbox });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /changed since the page loaded/);
  });

  test('refuses two clips with the same audio', async () => {
    const s = await state();
    const res = await send('POST', '/api/publish', { version: s.version, published: s.published, inbox: { clips: [s.published.clips[0]] } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /same audio file/);
  });

  test('a failed commit undoes the publish and leaves every file as it was', async () => {
    const s = await state();
    const ready = s.inbox.clips.find((c) => c.title === '(?????)');
    const published = { dimensions: s.published.dimensions, clips: [s.published.clips[0], ready] };
    const inboxBefore = fs.readFileSync(file('inbox', 'clips.json'));
    const dataBefore = fs.readFileSync(file('src', 'data', 'clips.json'));
    const head = git('rev-parse', 'HEAD');
    const hook = file('.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho hook says no >&2\nexit 1\n', { mode: 0o755 });
    try {
      const res = await send('POST', '/api/publish', { version: s.version, published, inbox: { clips: s.inbox.clips.filter((c) => c !== ready) } });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /Nothing was published.*hook says no/s);
    } finally {
      fs.rmSync(hook);
    }
    assert.equal(git('rev-parse', 'HEAD'), head, 'no commit');
    assert.equal(git('status', '--porcelain', '--', 'src'), '', 'nothing staged or changed under src/');
    assert.deepEqual(fs.readFileSync(file('src', 'data', 'clips.json')), dataBefore);
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips.json')), inboxBefore);
    assert.deepEqual(fs.readFileSync(file('inbox', 'clips', '0602_0029_(？？？？？).mp3')), AUDIO.question, 'the new clip is back in the inbox');
    assert.deepEqual(fs.readFileSync(file('src', 'clips', 'old.mp3')), AUDIO.publishedOld, 'the dropped clip keeps its audio');
    assert.ok(!fs.existsSync(file('inbox', '.publish-trash')));
  });

  test('refuses a new clip whose audio file is missing', async () => {
    const s = await state();
    const ghost = { title: 'Ghost', audio: 'clips/ghost.mp3', 'source-game': 'A', 'use-case': 'Hurt' };
    const dataBefore = fs.readFileSync(file('src', 'data', 'clips.json'));
    const head = git('rev-parse', 'HEAD');
    const res = await send('POST', '/api/publish', { version: s.version, published: { dimensions: s.published.dimensions, clips: [...s.published.clips, ghost] }, inbox: s.inbox });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /“Ghost” has no audio file/);
    assert.equal(git('rev-parse', 'HEAD'), head, 'no commit');
    assert.deepEqual(fs.readFileSync(file('src', 'data', 'clips.json')), dataBefore);
  });

  test('a failed commit removes an inbox list that did not exist before', async () => {
    const s = await state();
    const inboxBefore = fs.readFileSync(file('inbox', 'clips.json'));
    fs.rmSync(file('inbox', 'clips.json'));
    const hook = file('.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    try {
      const res = await send('POST', '/api/publish', { version: s.version, published: { dimensions: s.published.dimensions, clips: [s.published.clips[0]] }, inbox: { clips: [] } });
      assert.equal(res.status, 409);
      assert.ok(!fs.existsSync(file('inbox', 'clips.json')), 'no inbox list left behind');
    } finally {
      fs.rmSync(hook);
      fs.writeFileSync(file('inbox', 'clips.json'), inboxBefore);
    }
    assert.deepEqual(fs.readFileSync(file('src', 'clips', 'old.mp3')), AUDIO.publishedOld, 'the dropped clip keeps its audio');
  });

  test('moves ready clips out of the inbox, drops removed ones, commits only src/ and pushes', async () => {
    fs.writeFileSync(file('src', 'clips', 'stray.mp3'), audio()); // not part of this publish
    const s = await state();
    const ready = s.inbox.clips.find((c) => c.title === '(?????)');
    const rest = s.inbox.clips.filter((c) => c !== ready);
    // Keep Grunt, remove Old (its audio is deleted) and Gone (no audio), and publish the ready clip.
    const published = { dimensions: s.published.dimensions, clips: [s.published.clips[0], ready] };
    const res = await send('POST', '/api/publish', { version: s.version, published, inbox: { clips: rest } });
    const result = await res.json();
    assert.equal(res.status, 200, JSON.stringify(result));
    assert.equal(result.committed, true);
    assert.equal(result.pushed, true);
    assert.equal(result.message, `Pushed 1 new clip, 1 removed clip to ${BRANCH} (${result.commit}). They go live once ${BRANCH} is merged into main.`);

    const name = '0602_0029_(？？？？？).mp3';
    assert.deepEqual(fs.readFileSync(file('src', 'clips', name)), AUDIO.question, 'audio moved into src/clips');
    assert.ok(!fs.existsSync(file('inbox', 'clips', name)), 'and out of the inbox');
    assert.ok(!fs.existsSync(file('src', 'clips', 'old.mp3')), 'a removed clip loses its audio');

    const data = readJson('src', 'data', 'clips.json');
    assert.deepEqual(data.clips.map((c) => c.title), ['Grunt', '(?????)']);
    assert.ok(!('import-folder' in data.clips[1]), 'the import folder stays in the inbox');
    assert.equal(data.clips[1].recording, '0602');
    assert.equal(data.clips[1].wave, today(), 'a new clip gets today\'s wave');
    assert.ok(!('wave' in data.clips[0]), 'a clip published before keeps no wave');
    assert.deepEqual(data.dimensions.find((d) => d.key === 'wave'), { key: 'wave', label: 'Wave', defaultSort: true, order: [today()] });
    assert.deepEqual(readJson('inbox', 'clips.json').clips.map((c) => c.title), rest.map((c) => c.title));

    assert.equal(git('log', '-1', '--format=%s'), 'chore: publish 1 new clip, 1 removed clip');
    const changed = git('show', '--name-only', '--format=', 'HEAD').split('\n').map((p) => p.replace(/^"|"$/g, ''));
    assert.ok(changed.every((p) => p.startsWith('src/')), changed.join(', '));
    assert.ok(!changed.includes('src/clips/stray.mp3'), 'a file this publish did not touch is not committed');
    assert.match(git('status', '--porcelain', '--', 'src/clips/stray.mp3'), /^\?\?/);
    fs.rmSync(file('src', 'clips', 'stray.mp3'));
    assert.equal(git('rev-parse', `origin/${BRANCH}`), git('rev-parse', 'HEAD'));
    assert.equal(execFileSync('git', ['rev-parse', BRANCH], { cwd: remote, encoding: 'utf8' }).trim(), git('rev-parse', 'HEAD'));

    assert.equal(result.state.version, sha(fs.readFileSync(file('src', 'data', 'clips.json'))), 'the reply carries the new state');
    assert.deepEqual(result.state.missing, []);
  });

  test('the gallery then serves the published clip', async () => {
    const res = await get(`/gallery/clips/${enc('0602_0029_(？？？？？).mp3')}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO.question);
  });

  test('a new clip whose audio is already in src/clips is committed with its audio', async () => {
    const bytes = audio();
    fs.writeFileSync(file('src', 'clips', 'kept.mp3'), bytes); // untracked, as after a retried import
    const s = await state();
    const kept = { title: 'Kept', audio: 'clips/kept.mp3', 'source-game': 'A', 'use-case': ['Hurt', 'Victory'] };
    const res = await send('POST', '/api/publish', { version: s.version, published: { dimensions: s.published.dimensions, clips: [...s.published.clips, kept] }, inbox: s.inbox });
    const result = await res.json();
    assert.equal(res.status, 200, JSON.stringify(result));
    assert.equal(git('log', '-1', '--format=%s'), 'chore: publish 1 new clip');
    assert.ok(git('show', '--name-only', '--format=', 'HEAD').split('\n').includes('src/clips/kept.mp3'), 'the audio is in the commit');
    assert.deepEqual(readJson('src', 'data', 'clips.json').clips.at(-1)['use-case'], ['Hurt', 'Victory'], 'several use cases stay a list');
  });

  test('a later wave goes first, and a renamed wave keeps its clips and its place', async () => {
    // As if the last publish was on an earlier day, and the lead renamed that wave in the page.
    const s = await state();
    const renamed = s.published.clips.map((c) => (c.wave ? { ...c, wave: 'First batch' } : c));
    const dims = s.published.dimensions.map((d) => (d.key === 'wave' ? { ...d, order: ['First batch'] } : d));
    fs.writeFileSync(file('src', 'clips', 'later.mp3'), audio());
    const later = { title: 'Later', audio: 'clips/later.mp3', 'source-game': 'A', 'use-case': 'Hurt', wave: 'typed by the page' };
    const res = await send('POST', '/api/publish', { version: s.version, published: { dimensions: dims, clips: [...renamed, later] }, inbox: s.inbox });
    assert.equal(res.status, 200, JSON.stringify(await res.json()));
    const data = readJson('src', 'data', 'clips.json');
    assert.deepEqual(data.dimensions.find((d) => d.key === 'wave').order, [today(), 'First batch']);
    assert.equal(data.clips.at(-1).wave, today(), 'a new clip always gets the wave of the publish that adds it');
    assert.deepEqual(data.clips.filter((c) => c.wave === 'First batch').map((c) => c.title), ['(?????)', 'Kept']);
  });

  test('says so when nothing changed', async () => {
    const s = await state();
    const res = await send('POST', '/api/publish', { version: s.version, published: s.published, inbox: s.inbox });
    const result = await res.json();
    assert.equal(result.committed, false);
    assert.equal(result.message, 'Nothing changed, so nothing was published.');
  });

  test('says so plainly when the branch was deleted on GitHub', async () => {
    const s = await state();
    const head = git('rev-parse', 'HEAD');
    execFileSync('git', ['branch', '-D', BRANCH], { cwd: remote });
    try {
      const res = await send('POST', '/api/publish', { version: s.version, published: s.published, inbox: s.inbox });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, new RegExp(`${BRANCH} no longer exists on GitHub`));
      assert.equal(git('rev-parse', 'HEAD'), head, 'no commit');
    } finally {
      git('push', '--quiet', 'origin', BRANCH);
    }
  });

  test('refuses when clips.json has uncommitted changes', async () => {
    const s = await state();
    fs.appendFileSync(file('src', 'data', 'clips.json'), ' ');
    try {
      const res = await send('POST', '/api/publish', { version: sha(fs.readFileSync(file('src', 'data', 'clips.json'))), published: s.published, inbox: s.inbox });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /uncommitted changes/);
    } finally {
      git('checkout', '--', 'src/data/clips.json');
    }
  });
});
