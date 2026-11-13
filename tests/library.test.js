import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLibrary, syncLibrary, albumKey, groupByAlbum, groupByArtist, searchTracks, sortTracks } from '../js/library.js';
import { AuthError } from '../js/auth.js';

const file = (id, extra = {}) => ({ id, name: `Banda - Faixa ${id}.mp3`, folder: 'Álbum', size: 100, md5Checksum: `md5-${id}`, ...extra });
const track = (f, extra = {}) => ({ id: f.id, name: f.name, folder: f.folder, md5: f.md5Checksum, modifiedTime: null, removedFromDrive: false, ...extra });

test('diff: novas, alteradas (md5, nome, pasta, voltou), removidas e iguais', () => {
  const a = file('a'), b = file('b'), c = file('c'), d = file('d'), e = file('e');
  const local = [
    track(a),
    track(b, { md5: 'velho' }),
    track(c, { folder: 'Outra' }),
    track(d, { removedFromDrive: true }),
    track(file('x')),
    track(file('y'), { removedFromDrive: true }),
  ];
  const { added, changed, removed } = diffLibrary([a, b, c, d, e], local);
  assert.deepEqual(added.map((f) => f.id), ['e']);
  assert.deepEqual(changed.map((f) => f.id), ['b', 'c', 'd']);
  assert.deepEqual(removed.map((t) => t.id), ['x', 'y']); // inclusive a que já estava marcada de versões antigas
});

test('diff: sem md5 (arquivo sem conteúdo binário) compara pela data', () => {
  const f = file('a', { md5Checksum: undefined, modifiedTime: '2026-01-02' });
  assert.equal(diffLibrary([f], [track(f, { md5: null, modifiedTime: '2026-01-02' })]).changed.length, 0);
  assert.equal(diffLibrary([f], [track(f, { md5: null, modifiedTime: '2026-01-01' })]).changed.length, 1);
});

// ---- sincronização com Drive e banco em memória ----
function memDb() {
  const stores = new Map();
  const s = (n) => stores.get(n) ?? stores.set(n, new Map()).get(n);
  return {
    stores,
    get: async (n, k) => s(n).get(k),
    put: async (n, k, v) => { s(n).set(k, v); },
    del: async (n, k) => { s(n).delete(k); },
    getAll: async (n) => [...s(n).values()],
  };
}
// Tag ID3v2.3 mínima com título e capa, para o readTags real ler.
function mp3WithTag(title) {
  const t = Uint8Array.from(`\0${title}`, (c) => c.charCodeAt(0));
  const pic = Uint8Array.from('\0image/jpeg\0\x03\0IMG', (c) => c.charCodeAt(0));
  const fr = (id, d) => [...id].map((c) => c.charCodeAt(0)).concat([0, 0, 0, d.length, 0, 0], [...d]);
  const body = [...fr('TIT2', t), ...fr('TPE1', Uint8Array.from('\0Banda', (c) => c.charCodeAt(0))), ...fr('TALB', Uint8Array.from('\0Disco', (c) => c.charCodeAt(0))), ...fr('APIC', pic)];
  return Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, body.length, ...body]);
}
function fakeDrive(files, { failAfter = Infinity } = {}) {
  let ranges = 0;
  return {
    get ranges() { return ranges; },
    files,
    findFolder: async () => 'pasta1',
    listAudio: async () => files,
    downloadRange: async (id, start, end) => {
      if (++ranges > failAfter) throw new AuthError();
      return mp3WithTag(`Título ${id}`).slice(start, end + 1).buffer;
    },
  };
}

test('sincroniza: grava faixas e capa; 2ª rodada sem mudança não baixa nada', async () => {
  const db = memDb();
  const drive = fakeDrive([file('a'), file('b'), file('c')]);
  const progress = [];
  const r1 = await syncLibrary({ drive, db, onProgress: (p) => progress.push(p) });
  assert.deepEqual(r1, { total: 3, added: 3, changed: 0, removed: 0, removedIds: [] });
  const a = await db.get('tracks', 'a');
  assert.equal(a.title, 'Título a');
  assert.equal(a.artist, 'Banda');
  assert.equal(a.album, 'Disco');
  assert.equal(a.hasArt, true);
  assert.ok(await db.get('art', albumKey('Banda', 'Disco')));
  assert.equal(await db.get('meta', 'folderId'), 'pasta1');
  assert.deepEqual(progress.at(-2), { phase: 'tags', done: 3, total: 3 });

  const before = drive.ranges;
  const r2 = await syncLibrary({ drive, db });
  assert.deepEqual(r2, { total: 3, added: 0, changed: 0, removed: 0, removedIds: [] });
  assert.equal(drive.ranges, before);
});

test('faixa apagada do Drive some da biblioteca e do celular', async () => {
  const db = memDb();
  const drive = fakeDrive([file('a'), file('b')]);
  await syncLibrary({ drive, db });
  await db.put('audio', 'b', new Blob(['x']));
  drive.files.pop();
  const r = await syncLibrary({ drive, db });
  assert.equal(r.removed, 1);
  assert.deepEqual(r.removedIds, ['b']);
  assert.equal(await db.get('tracks', 'b'), undefined);
  assert.equal(await db.get('audio', 'b'), undefined);
  assert.equal((await db.getAll('tracks')).length, 1);
});

test('login vence no meio: o que foi gravado fica e a próxima rodada continua', async () => {
  const db = memDb();
  const files = Array.from({ length: 10 }, (_, i) => file(`f${i}`));
  await assert.rejects(syncLibrary({ drive: fakeDrive(files, { failAfter: 4 }), db, concurrency: 1 }), AuthError);
  const saved = (await db.getAll('tracks')).length;
  assert.ok(saved >= 1 && saved < 10);

  const drive = fakeDrive(files);
  const r = await syncLibrary({ drive, db });
  assert.equal(r.added, 10 - saved);
  assert.equal((await db.getAll('tracks')).length, 10);
});

test('pasta Músicas não existe: erro claro', async () => {
  const drive = { ...fakeDrive([]), findFolder: async () => null };
  await assert.rejects(syncLibrary({ drive, db: memDb() }), /não foi encontrada/);
});

// ---- agrupar e buscar (T6) ----
const t = (id, title, artist, album, trackNo = null) => ({ id, title, artist, album, trackNo, hasArt: id === 'c' });
const lib = [
  t('a', 'Vento', 'José Silva', 'Mar', 2),
  t('b', 'Areia', 'josé silva', 'Mar', 1),
  t('c', 'Sem número', 'José Silva', 'Mar'),
  t('d', 'Céu', 'Ana', 'Ábaco', 10),
  t('e', 'Chão', 'Ana', 'Ábaco', 9),
];

test('álbum: faixas pela ordem do número, sem número no fim; capa se alguma tiver', () => {
  const albums = groupByAlbum(lib);
  assert.deepEqual(albums.map((g) => g.album), ['Ábaco', 'Mar']);
  assert.deepEqual(albums[0].tracks.map((x) => x.id), ['e', 'd']); // 9 antes de 10
  assert.deepEqual(albums[1].tracks.map((x) => x.id), ['b', 'a', 'c']);
  assert.equal(albums[1].hasArt, true);
  assert.equal(albums[1].key, albumKey('José Silva', 'Mar'));
});

test('artista: junta grafias com maiúscula diferente e lista os álbuns', () => {
  const artists = groupByArtist(lib);
  assert.deepEqual(artists.map((g) => g.artist), ['Ana', 'José Silva']);
  assert.equal(artists[1].tracks.length, 3);
  assert.deepEqual(artists[1].albums.map((g) => g.album), ['Mar']);
});

test('busca ignora acento e maiúscula, em título, artista e álbum', () => {
  const ids = (q) => searchTracks(lib, q).map((x) => x.id).sort();
  assert.deepEqual(ids('jose'), ['a', 'b', 'c']);
  assert.deepEqual(ids('CEU'), ['d']);
  assert.deepEqual(ids('abaco chao'), ['e']); // todas as palavras precisam aparecer
  assert.equal(searchTracks(lib, '  ').length, 5);
  assert.deepEqual(sortTracks(lib).map((x) => x.id), ['d', 'e', 'b', 'c', 'a']); // Céu antes de Chão
});
