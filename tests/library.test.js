import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLibrary, syncLibrary, albumKey } from '../js/library.js';
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
  assert.deepEqual(removed.map((t) => t.id), ['x']); // 'y' já estava marcada
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
  assert.deepEqual(r1, { total: 3, added: 3, changed: 0, removed: 0 });
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
  assert.deepEqual(r2, { total: 3, added: 0, changed: 0, removed: 0 });
  assert.equal(drive.ranges, before);
});

test('faixa apagada do Drive fica marcada, não é apagada; volta se reaparecer', async () => {
  const db = memDb();
  const drive = fakeDrive([file('a'), file('b')]);
  await syncLibrary({ drive, db });
  drive.files.pop();
  const r = await syncLibrary({ drive, db });
  assert.equal(r.removed, 1);
  assert.equal((await db.get('tracks', 'b')).removedFromDrive, true);
  assert.equal((await db.getAll('tracks')).length, 2);

  drive.files.push(file('b'));
  await syncLibrary({ drive, db });
  assert.equal((await db.get('tracks', 'b')).removedFromDrive, false);
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
