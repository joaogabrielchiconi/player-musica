import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaylists, newPlaylist, addTracks, removeTrackAt, moveTrack, tracksOf, sanitize, cleanName } from '../js/playlists.js';

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
