// Fila de reprodução (pura, sem áudio): ordem, aleatório, repetir, próxima e anterior.
// q = { items, order, pos, shuffle, repeat }: order são índices de items; pos é a posição em order.

export const REPEAT_MODES = ['off', 'all', 'one'];
export const nextRepeat = (r) => REPEAT_MODES[(REPEAT_MODES.indexOf(r) + 1) % REPEAT_MODES.length];

// Fisher-Yates: cada faixa aparece uma vez só, até a fila acabar.
function shuffled(arr, random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// No aleatório, a faixa escolhida toca primeiro e as outras vêm embaralhadas.
function makeOrder(n, first, shuffle, random) {
  const all = Array.from({ length: n }, (_, i) => i);
  if (!shuffle || !n) return all;
  return [first, ...shuffled(all.filter((i) => i !== first), random)];
}

export function newQueue(items, start = 0, { shuffle = false, repeat = 'off' } = {}, random = Math.random) {
  const order = makeOrder(items.length, start, shuffle, random);
  return { items, order, pos: shuffle ? 0 : start, shuffle, repeat };
}

export const trackAt = (q, pos) => (pos >= 0 && pos < q.order.length ? q.items[q.order[pos]] : null);
export const current = (q) => trackAt(q, q.pos);

/** Posição seguinte, ou -1 no fim. auto = a faixa terminou sozinha (só aí "repetir uma" repete). */
export function nextPos(q, auto = false) {
  if (auto && q.repeat === 'one') return q.pos;
  if (q.pos + 1 < q.order.length) return q.pos + 1;
  return q.repeat === 'all' && q.order.length ? 0 : -1;
}

/** Anterior: depois de 3 s volta ao início da faixa; antes disso, vai para a faixa anterior. */
export function prevPos(q, currentTime) {
  if (currentTime > 3) return { restart: true };
  if (q.pos > 0) return { pos: q.pos - 1 };
  if (q.repeat === 'all' && q.order.length > 1) return { pos: q.order.length - 1 };
  return { restart: true };
}

export function withShuffle(q, shuffle, random = Math.random) {
  const idx = q.order[q.pos] ?? 0;
  return { ...q, shuffle, order: makeOrder(q.items.length, idx, shuffle, random), pos: shuffle ? 0 : idx };
}
