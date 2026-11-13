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

/** Põe a faixa logo depois da atual (next) ou no fim da fila. A mesma faixa pode entrar de novo: é um item novo. */
export function enqueue(q, t, next) {
  const items = [...q.items, t];
  const order = [...q.order];
  order.splice(next ? q.pos + 1 : order.length, 0, items.length - 1);
  return { ...q, items, order };
}

// ---- estado salvo (T8): só IDs, posição e tempo; as faixas vêm do banco ao restaurar ----
export function serializeState(q, time = 0, duration = 0) {
  return { v: 1, ids: q.items.map((t) => t.id), order: q.order, pos: q.pos, shuffle: q.shuffle, repeat: q.repeat, time, duration };
}

/**
 * Estado salvo -> { q, time, duration }, ou null se estiver corrompido ou a faixa atual não existir mais
 * (o app abre com o player vazio). Faixas apagadas do meio da fila só saem da fila.
 * @param {any} raw
 * @param {Map<string, object>} byId  faixas atuais do banco
 */
export function restoreState(raw, byId) {
  try {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.ids) || !Array.isArray(raw.order)) return null;
    const items = [];
    const remap = new Map(); // índice antigo -> novo
    raw.ids.forEach((id, i) => {
      const t = byId.get(id);
      if (t) { remap.set(i, items.length); items.push(t); }
    });
    const order = raw.order.map((i) => remap.get(i)).filter((i) => i !== undefined);
    const now = remap.get(raw.order[raw.pos]);
    if (now === undefined) return null;
    const time = Number.isFinite(raw.time) && raw.time > 0 ? raw.time : 0;
    const duration = Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : 0;
    const q = {
      items, order, pos: order.indexOf(now),
      shuffle: raw.shuffle === true,
      repeat: REPEAT_MODES.includes(raw.repeat) ? raw.repeat : 'off',
    };
    return { q, time, duration };
  } catch {
    return null;
  }
}
