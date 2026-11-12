import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newQueue, current, nextPos, prevPos, withShuffle, nextRepeat, trackAt } from '../js/queue.js';

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
