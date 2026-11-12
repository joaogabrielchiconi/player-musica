import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQueue, current, nextPos, prevPos, withShuffle, nextRepeat, trackAt, serializeState, restoreState } from '../js/queue.js';

const items = ['a', 'b', 'c', 'd', 'e'];
// Gerador previsível para o aleatório.
const seeded = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

test('em ordem: começa na faixa escolhida e para no fim', () => {
  const q = newQueue(items, 2);
  assert.equal(current(q), 'c');
  assert.equal(nextPos(q), 3);
  assert.equal(nextPos({ ...q, pos: 4 }), -1);
});

test('aleatório: escolhida primeiro, todas uma vez só até acabar', () => {
  const q = newQueue(items, 3, { shuffle: true }, seeded(7));
  assert.equal(current(q), 'd');
  const played = q.order.map((_, p) => trackAt(q, p));
  assert.deepEqual([...played].sort(), items);
  assert.equal(nextPos({ ...q, pos: 4 }), -1);
});

test('repetir tudo volta ao começo; repetir uma só repete quando termina sozinha', () => {
  const all = { ...newQueue(items, 4), repeat: 'all' };
  assert.equal(nextPos(all), 0);
  const one = { ...newQueue(items, 1), repeat: 'one' };
  assert.equal(nextPos(one, true), 1);
  assert.equal(nextPos(one, false), 2); // botão próxima pula mesmo assim
  assert.equal(nextRepeat('off'), 'all');
  assert.equal(nextRepeat('all'), 'one');
  assert.equal(nextRepeat('one'), 'off');
});

test('anterior: depois de 3 s volta ao início; antes, faixa anterior', () => {
  const q = newQueue(items, 2);
  assert.deepEqual(prevPos(q, 3.5), { restart: true });
  assert.deepEqual(prevPos(q, 1), { pos: 1 });
  assert.deepEqual(prevPos({ ...q, pos: 0 }, 1), { restart: true });
  assert.deepEqual(prevPos({ ...q, pos: 0, repeat: 'all' }, 1), { pos: 4 });
});

test('ligar e desligar o aleatório mantém a faixa atual', () => {
  const q = newQueue(items, 2);
  const s = withShuffle(q, true, seeded(3));
  assert.equal(current(s), 'c');
  assert.equal(s.pos, 0);
  const back = withShuffle({ ...s, pos: 3 }, false);
  assert.equal(current(back), trackAt(s, 3));
  assert.deepEqual(back.order, [0, 1, 2, 3, 4]);
});

test('fila vazia: aleatório não inventa faixa', () => {
  const s = withShuffle(newQueue([], 0), true);
  assert.deepEqual(s.order, []);
  assert.equal(current(s), null);
  assert.equal(nextPos(s), -1);
});

// ---- estado salvo (T8) ----
const objs = items.map((id) => ({ id }));
const lib = new Map(objs.map((t) => [t.id, t]));
const only = (...ids) => new Map(ids.map((id) => [id, { id }]));
const ids = (q) => q.items.map((t) => t.id);

test('estado: salvar e restaurar devolve a mesma fila, faixa e ponto', () => {
  const q = newQueue(objs, 2, { shuffle: true, repeat: 'all' }, seeded(5));
  const r = restoreState(JSON.parse(JSON.stringify(serializeState(q, 41.5, 200))), lib);
  assert.deepEqual(r.q, q);
  assert.equal(current(r.q).id, 'c');
  assert.equal(r.time, 41.5);
  assert.equal(r.duration, 200);
});

test('estado: faixa apagada do meio sai da fila; a atual continua a mesma', () => {
  const r = restoreState(serializeState(newQueue(objs, 3), 10, 100), only('a', 'b', 'd', 'e'));
  assert.deepEqual(ids(r.q), ['a', 'b', 'd', 'e']);
  assert.equal(current(r.q).id, 'd');
});

test('estado: faixa atual que não existe mais, ou dado corrompido, vira player vazio', () => {
  assert.equal(restoreState(serializeState(newQueue(objs, 2), 1, 1), only('a', 'b')), null);
  for (const bad of [null, undefined, 'x', 42, {}, { v: 1 }, { v: 2, ids: [], order: [] }, { v: 1, ids: ['a'], order: ['z'], pos: 0 }, { v: 1, ids: ['a'], order: [0], pos: 9 }]) {
    assert.equal(restoreState(bad, lib), null);
  }
});

test('estado: tempo, repetir e aleatório inválidos viram valores seguros', () => {
  const r = restoreState({ v: 1, ids: ['a', 'b'], order: [0, 1], pos: 1, time: -5, duration: 'x', repeat: 'tudo', shuffle: 'sim' }, lib);
  assert.deepEqual([r.time, r.duration, r.q.repeat, r.q.shuffle, current(r.q).id], [0, 0, 'off', false, 'b']);
});
