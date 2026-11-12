import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaylists, newPlaylist, addTracks, removeTrackAt, moveTrack, tracksOf, sanitize, cleanName, createPlaylistBackup, toBackup, fromBackup, BACKUP_FILE } from '../js/playlists.js';

function memDb() {
  const m = new Map();
  return {
    m,
    getAll: async () => [...m.values()],
    put: async (s, k, v) => { m.set(k, v); },
    del: async (s, k) => { m.delete(k); },
  };
}

test('nome: tira espaços sobrando e limita; vazio não cria', async () => {
  assert.equal(cleanName('  Minha   lista  '), 'Minha lista');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
  const p = createPlaylists({ db: memDb() });
  assert.equal(await p.create('   '), null);
  assert.equal(p.list().length, 0);
});

test('adicionar: mantém a ordem e não repete', () => {
  const pl = newPlaylist('A', 'p1', 1);
  const r1 = addTracks(pl, ['a', 'b', 'a', 'c'], 2);
  assert.deepEqual(r1.playlist.trackIds, ['a', 'b', 'c']);
  assert.equal(r1.added, 3);
  const r2 = addTracks(r1.playlist, ['b', 'd'], 3);
  assert.deepEqual(r2.playlist.trackIds, ['a', 'b', 'c', 'd']);
  assert.equal(r2.added, 1);
  const r3 = addTracks(r2.playlist, ['a'], 4);
  assert.equal(r3.added, 0);
  assert.equal(r3.playlist, r2.playlist); // nada mudou: mesmo objeto
});

test('reordenar e remover', () => {
  const pl = { ...newPlaylist('A', 'p1', 1), trackIds: ['a', 'b', 'c', 'd', 'e'] };
  assert.deepEqual(moveTrack(pl, 0, 2).trackIds, ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(moveTrack(pl, 4, 0).trackIds, ['e', 'a', 'b', 'c', 'd']);
  assert.equal(moveTrack(pl, 1, 1), pl);
  assert.equal(moveTrack(pl, -1, 2), pl);
  assert.equal(moveTrack(pl, 0, 5), pl);
  assert.deepEqual(removeTrackAt(pl, 1).trackIds, ['a', 'c', 'd', 'e']);
  assert.equal(removeTrackAt(pl, 9), pl);
});

test('faixa que saiu da biblioteca fica de fora ao tocar, sem apagar da playlist', () => {
  const pl = { ...newPlaylist('A', 'p1'), trackIds: ['a', 'x', 'b'] };
  const byId = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
  assert.deepEqual(tracksOf(pl, byId).map((t) => t.id), ['a', 'b']);
  assert.equal(pl.trackIds.length, 3);
});

test('banco: criar, editar, reabrir o app e apagar', async () => {
  const db = memDb();
  let changes = 0;
  const p = createPlaylists({ db, onChange: () => changes++ });
  const pl = await p.create('Treino');
  assert.equal(await p.add(pl.id, ['a', 'b', 'c', 'd', 'e']), 5);
  await p.move(pl.id, 4, 0);
  await p.removeAt(pl.id, 2);
  await p.rename(pl.id, 'Corrida');
  assert.ok(changes >= 5);

  // "reabrir o app": instância nova lendo o mesmo banco
  const again = createPlaylists({ db });
  await again.init();
  assert.equal(again.get(pl.id).name, 'Corrida');
  assert.deepEqual(again.get(pl.id).trackIds, ['e', 'a', 'c', 'd']);

  await again.remove(pl.id);
  assert.equal(db.m.size, 0);
  assert.equal(again.list().length, 0);
});

test('dado quebrado no banco é ignorado, o resto abre', async () => {
  const db = memDb();
  db.m.set('ok', { id: 'ok', name: 'Boa', trackIds: ['a', 'a', 7, 'b'], createdAt: 1, updatedAt: 2 });
  for (const [k, bad] of Object.entries({ n: null, s: 'x', sem_nome: { id: 'z', name: '  ', trackIds: [] }, sem_lista: { id: 'y', name: 'Y' } })) db.m.set(k, bad);
  const p = createPlaylists({ db });
  await p.init();
  assert.deepEqual(p.list().map((x) => x.id), ['ok']);
  assert.deepEqual(p.get('ok').trackIds, ['a', 'b']);
  assert.equal(sanitize({ id: 1, name: 'x', trackIds: [] }), null);
});

test('lista: a mexida mais recentemente vem primeiro', async () => {
  const p = createPlaylists({ db: memDb() });
  const a = await p.create('A');
  await new Promise((r) => setTimeout(r, 5));
  const b = await p.create('B');
  assert.deepEqual(p.list().map((x) => x.name), ['B', 'A']);
  await new Promise((r) => setTimeout(r, 5));
  await p.add(a.id, ['x']);
  assert.deepEqual(p.list().map((x) => x.name), ['A', 'B']);
  assert.ok(b);
});

// ---- backup no Drive (T12) ----
function fullDb() {
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
// appDataFolder falso: { id: texto }.
function fakeAppData(initial = null) {
  const files = new Map();
  if (initial !== null) files.set('bk1', initial);
  const writes = [];
  return {
    files,
    writes,
    findAppData: async () => (files.size ? { id: [...files.keys()][0] } : null),
    readAppData: async (id) => files.get(id),
    writeAppData: async (name, text, id) => {
      assert.equal(name, BACKUP_FILE);
      const fid = id ?? `novo${writes.length}`;
      files.set(fid, text);
      writes.push({ id: fid, text });
      return fid;
    },
  };
}
function setupBackup({ backup = null, library = ['a', 'b', 'c'] } = {}) {
  const db = fullDb();
  for (const id of library) db.stores.set('tracks', (db.stores.get('tracks') ?? new Map()).set(id, { id }));
  const drive = fakeAppData(backup === null ? null : JSON.stringify(backup));
  let bk;
  const store = createPlaylists({ db, onChange: () => bk.changed() });
  const restored = [];
  bk = createPlaylistBackup({
    store, drive, db, delayMs: 0,
    libraryIds: async () => new Set((db.stores.get('tracks') ?? new Map()).keys()),
    onRestored: (r) => restored.push(r),
  });
  return { db, drive, store, bk, restored };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const saved = (drive) => JSON.parse([...drive.files.values()].at(-1));

test('backup: formato version 1, só com os campos da playlist', () => {
  const b = toBackup([{ ...newPlaylist('A', 'p1', 5), extra: 'x' }], 9);
  assert.deepEqual(b, { version: 1, savedAt: 9, playlists: [{ id: 'p1', name: 'A', trackIds: [], createdAt: 5, updatedAt: 5 }] });
  assert.equal(fromBackup({ version: 2, playlists: [] }), null);
  assert.deepEqual(fromBackup(JSON.parse(JSON.stringify(b))).map((p) => p.id), ['p1']);
});

test('instalação nova: restaura do Drive, tira faixa que não existe mais e avisa', async () => {
  const backup = toBackup([{ ...newPlaylist('Treino', 'p1', 1), trackIds: ['a', 'sumiu', 'b'] }, { ...newPlaylist('Vazia', 'p2', 1) }]);
  const { store, bk, restored, drive } = setupBackup({ backup });
  await bk.sync({ canRestore: true });
  assert.deepEqual(store.get('p1').trackIds, ['a', 'b']);
  assert.ok(store.get('p2'));
  assert.deepEqual(restored, [{ playlists: 2, droppedTracks: 1 }]);
  await settle();
  // depois de restaurar, grava a versão limpa (sem a faixa que sumiu) no mesmo arquivo
  assert.deepEqual(saved(drive).playlists.find((p) => p.id === 'p1').trackIds, ['a', 'b']);
  assert.equal(drive.writes.at(-1).id, 'bk1');
});

test('segurança: antes de conferir o backup, nenhuma gravação (nem com mudanças)', async () => {
  const backup = toBackup([{ ...newPlaylist('Antiga', 'p1', 1), trackIds: ['a'] }]);
  const { store, bk, drive } = setupBackup({ backup });
  await store.create('Nova antes do login');
  await settle(); // o debounce rodou sync() sem canRestore
  assert.equal(drive.writes.length, 0);
  await bk.sync({ canRestore: true });
  await settle();
  const names = saved(drive).playlists.map((p) => p.name).sort();
  assert.deepEqual(names, ['Antiga', 'Nova antes do login']); // juntou, não perdeu nenhuma
});

test('biblioteca vazia: não restaura (tudo pareceria faixa sumida) e não grava', async () => {
  const backup = toBackup([{ ...newPlaylist('A', 'p1', 1), trackIds: ['a'] }]);
  const { store, bk, drive } = setupBackup({ backup, library: [] });
  await bk.sync({ canRestore: true });
  assert.equal(store.list().length, 0);
  assert.equal(drive.writes.length, 0);
});

test('depois de conferido: cada mudança grava; sem mudança não grava; apagar tudo grava lista vazia', async () => {
  const { store, bk, drive } = setupBackup();
  await bk.sync({ canRestore: true }); // sem backup no Drive
  const pl = await store.create('A');
  await settle();
  assert.equal(drive.writes.length, 1);
  await bk.sync();
  assert.equal(drive.writes.length, 1); // nada pendente
  await store.add(pl.id, ['a']);
  await settle();
  assert.equal(drive.writes.length, 2);
  assert.equal(drive.writes[1].id, drive.writes[0].id); // mesmo arquivo
  await store.remove(pl.id);
  await settle();
  assert.deepEqual(saved(drive).playlists, []);
  // reinstalar de novo não ressuscita a apagada: o app já conferiu nesta instalação
  await bk.sync({ canRestore: true });
  assert.equal(store.list().length, 0);
});

test('backup corrompido no Drive: confere, ignora e grava o que há aqui', async () => {
  const { store, bk, drive } = setupBackup();
  drive.files.set('bk1', '{quebrado');
  await bk.sync({ canRestore: true });
  await store.create('Local');
  await settle();
  assert.deepEqual(saved(drive).playlists.map((p) => p.name), ['Local']);
});

test('sem internet ao gravar: fica pendente e grava na próxima rodada', async () => {
  const { store, bk, drive } = setupBackup();
  await bk.sync({ canRestore: true });
  const real = drive.writeAppData;
  drive.writeAppData = async () => { throw new TypeError('Load failed'); };
  await store.create('A');
  await settle();
  assert.equal(drive.writes.length, 0);
  drive.writeAppData = real;
  await bk.sync();
  assert.deepEqual(saved(drive).playlists.map((p) => p.name), ['A']);
});
