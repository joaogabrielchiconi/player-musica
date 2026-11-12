import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, isAudio } from '../js/drive.js';
import { AuthError } from '../js/auth.js';

const FOLDER = 'application/vnd.google-apps.folder';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

// Drive falso: { pastaId: [arquivos] }, paginado de 1000 em 1000 como o real.
function fakeDrive(tree, { pageSize = 1000 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const parent = u.searchParams.get('q').match(/^'([^']+)' in parents/)[1];
    const all = tree[parent] ?? [];
    const start = Number(u.searchParams.get('pageToken') ?? 0);
    const files = all.slice(start, start + pageSize);
    const next = start + pageSize < all.length ? String(start + pageSize) : undefined;
    return json({ files, ...(next && { nextPageToken: next }) });
  };
  return { fetch, calls };
}

const mp3 = (i) => ({ id: `f${i}`, name: `Faixa ${i}.mp3`, mimeType: 'audio/mpeg', size: '1000' });

test('lista pasta com mais de 1000 arquivos e subpastas, com paginação', async () => {
  const root = Array.from({ length: 1500 }, (_, i) => mp3(i));
  root.push({ id: 'sub', name: 'Álbum X', mimeType: FOLDER });
  root.push({ id: 'capa', name: 'capa.jpg', mimeType: 'image/jpeg' });
  const tree = { root1: root, sub: [mp3('s1'), { id: 'sub2', name: 'CD 2', mimeType: FOLDER }], sub2: [mp3('s2')] };
  const { fetch, calls } = fakeDrive(tree);
  const drive = createDrive({ getToken: () => 'tok', fetch });

  const tracks = await drive.listAudio('root1');

  assert.equal(tracks.length, 1502);
  assert.equal(tracks.find((t) => t.id === 'fs1').folder, 'Álbum X');
  assert.equal(tracks.find((t) => t.id === 'fs2').folder, 'Álbum X/CD 2');
  assert.equal(tracks[0].size, 1000);
  assert.ok(!tracks.some((t) => t.id === 'capa'));
  const rootCalls = calls.filter((c) => new URL(c.url).searchParams.get('q').startsWith("'root1'"));
  assert.equal(rootCalls.length, 2); // duas páginas
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('401 renova o token uma vez e repete a chamada', async () => {
  let n = 0;
  const fetch = async (url, init) => (n++ === 0 ? json({}, 401) : json({ files: [{ id: 'p1' }], seen: init.headers.Authorization }));
  let renewed = 0;
  const drive = createDrive({ getToken: () => 'velho', onUnauthorized: () => { renewed++; return 'novo'; }, fetch });

  assert.equal(await drive.findFolder(), 'p1');
  assert.equal(renewed, 1);
  assert.equal(n, 2);
});

test('401 sem renovação vira AuthError (sem repetir em loop)', async () => {
  let n = 0;
  const fetch = async () => { n++; return json({}, 401); };
  const drive = createDrive({ getToken: () => 'velho', onUnauthorized: () => 'novo', fetch });
  await assert.rejects(drive.findFolder(), AuthError);
  assert.equal(n, 2);

  const semToken = createDrive({ getToken: () => null, fetch });
  await assert.rejects(semToken.findFolder(), AuthError);
});

test('erro do Drive vira DriveError com o status', async () => {
  const drive = createDrive({ getToken: () => 't', fetch: async () => new Response('limite', { status: 403 }) });
  await assert.rejects(drive.findFolder(), (e) => e.name === 'DriveError' && e.status === 403);
});

test('downloadRange manda o cabeçalho Range', async () => {
  let headers;
  const fetch = async (url, init) => { headers = init.headers; return new Response(new Uint8Array([1, 2, 3]), { status: 206 }); };
  const drive = createDrive({ getToken: () => 't', fetch });
  const buf = await drive.downloadRange('abc', 0, 2);
  assert.equal(headers.Range, 'bytes=0-2');
  assert.equal(buf.byteLength, 3);
});

test('findFolder escapa aspas no nome', async () => {
  let q;
  const fetch = async (url) => { q = new URL(url).searchParams.get('q'); return json({ files: [] }); };
  const drive = createDrive({ getToken: () => 't', fetch });
  assert.equal(await drive.findFolder("D'Ávila"), null);
  assert.match(q, /name = 'D\\'Ávila'/);
});

test('isAudio reconhece por mimeType ou extensão', () => {
  assert.ok(isAudio({ name: 'a.mp3', mimeType: 'application/octet-stream' }));
  assert.ok(isAudio({ name: 'sem extensão', mimeType: 'audio/mp4' }));
  assert.ok(!isAudio({ name: 'x.mp3', mimeType: FOLDER }));
  assert.ok(!isAudio({ name: 'capa.jpg', mimeType: 'image/jpeg' }));
});

// ---- appDataFolder (T12) ----
function appDataDrive(existing = []) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body, headers: init.headers });
    const u = new URL(url);
    if (u.pathname.endsWith('/drive/v3/files') && (init.method ?? 'GET') === 'GET') return json({ files: existing });
    if (u.pathname.startsWith('/upload/') && init.method === 'POST') return json({ id: 'novo1' });
    if (u.pathname.startsWith('/upload/') && init.method === 'PATCH') return json({ id: u.pathname.split('/').pop() });
    if (u.searchParams.get('alt') === 'media') return new Response('{"version":1}');
    return json({}, 404);
  };
  return { fetch, calls };
}

test('appData: procura só no appDataFolder e lê o conteúdo', async () => {
  const { fetch, calls } = appDataDrive([{ id: 'bk1', name: 'playlists.json' }]);
  const drive = createDrive({ getToken: () => 't', fetch });
  const f = await drive.findAppData('playlists.json');
  assert.equal(f.id, 'bk1');
  assert.equal(new URL(calls[0].url).searchParams.get('spaces'), 'appDataFolder');
  assert.equal(await drive.readAppData('bk1'), '{"version":1}');
});

test('appData: criar vai para o appDataFolder; atualizar só um ID que veio de lá', async () => {
  const { fetch, calls } = appDataDrive([{ id: 'bk1', name: 'playlists.json' }]);
  const drive = createDrive({ getToken: () => 't', fetch });

  const id = await drive.writeAppData('playlists.json', '{"a":1}');
  assert.equal(id, 'novo1');
  const post = calls.at(-1);
  assert.equal(post.method, 'POST');
  assert.match(post.url, /\/upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(post.body, /"parents":\["appDataFolder"\]/);

  // ID que não veio do appDataFolder (ex.: uma música): recusado sem chamar a rede.
  const before = calls.length;
  await assert.rejects(drive.writeAppData('playlists.json', '{}', 'faixa123'), /recusada/);
  assert.equal(calls.length, before);

  await drive.findAppData('playlists.json');
  assert.equal(await drive.writeAppData('playlists.json', '{"b":2}', 'bk1'), 'bk1');
  const patch = calls.at(-1);
  assert.equal(patch.method, 'PATCH');
  assert.match(patch.url, /\/upload\/drive\/v3\/files\/bk1\?uploadType=media/);
  assert.equal(patch.body, '{"b":2}');
  // o que este app criou também pode ser atualizado
  assert.equal(await drive.writeAppData('playlists.json', '{}', 'novo1'), 'novo1');
});

test('nenhuma escrita fora das funções de appData (conferência no código)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/drive.js', import.meta.url), 'utf8');
  const writes = [...src.matchAll(/method: '(POST|PATCH|PUT|DELETE)'/g)].map((m) => m.index);
  const start = src.indexOf('async function writeAppData');
  const end = src.indexOf('return { request', start);
  assert.equal(writes.length, 2);
  for (const i of writes) assert.ok(i > start && i < end, 'escrita fora de writeAppData');
});
