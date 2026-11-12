// Playlists (T11): nome + lista de IDs de faixas, no store playlists do IndexedDB (chave = ID da playlist).
// Só IDs: a playlist nunca guarda cópia da música, então apagar uma playlist não toca nas faixas nem nos downloads.
// O backup no Drive (T12) liga em onChange.

export const MAX_NAME = 80;
export const cleanName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);

export const newPlaylist = (name, id = crypto.randomUUID(), now = Date.now()) => ({
  id, name: cleanName(name), trackIds: [], createdAt: now, updatedAt: now,
});

/** Junta ids no fim, sem repetir (nem dentro da própria lista). Devolve { playlist, added }. */
export function addTracks(pl, ids, now = Date.now()) {
  const have = new Set(pl.trackIds);
  const fresh = [];
  for (const id of ids) if (!have.has(id)) { have.add(id); fresh.push(id); }
  return { playlist: fresh.length ? { ...pl, trackIds: [...pl.trackIds, ...fresh], updatedAt: now } : pl, added: fresh.length };
}

export function removeTrackAt(pl, index, now = Date.now()) {
  if (!Number.isInteger(index) || index < 0 || index >= pl.trackIds.length) return pl;
  return { ...pl, trackIds: pl.trackIds.filter((_, i) => i !== index), updatedAt: now };
}

export function moveTrack(pl, from, to, now = Date.now()) {
  const n = pl.trackIds.length;
  if (![from, to].every((i) => Number.isInteger(i) && i >= 0 && i < n) || from === to) return pl;
  const ids = [...pl.trackIds];
  ids.splice(to, 0, ...ids.splice(from, 1));
  return { ...pl, trackIds: ids, updatedAt: now };
}

/** IDs -> faixas da biblioteca, na ordem da playlist; o que não existe mais na biblioteca fica de fora. */
export const tracksOf = (pl, byId) => pl.trackIds.map((id) => byId.get(id)).filter(Boolean);

// Dado vindo do banco (ou, na T12, do backup) pode estar quebrado: só entra o que tem formato certo.
export function sanitize(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.trackIds)) return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: raw.id,
    name,
    trackIds: [...new Set(raw.trackIds.filter((x) => typeof x === 'string'))],
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

/**
 * @param {object} o
 * @param {{ getAll, put, del }} o.db
 * @param {() => void} [o.onChange]
 */
export function createPlaylists({ db, onChange = () => {} }) {
  let items = new Map(); // id -> playlist

  const save = async (pl) => {
    items.set(pl.id, pl);
    await db.put('playlists', pl.id, pl);
    onChange();
  };

  return {
    async init() {
      items = new Map((await db.getAll('playlists')).map(sanitize).filter(Boolean).map((p) => [p.id, p]));
    },
    /** Mais recente primeiro; empate (ou datas zeradas) pelo nome. */
    list: () => [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'pt-BR')),
    get: (id) => items.get(id) ?? null,
    async create(name) {
      const pl = newPlaylist(name);
      if (!pl.name) return null;
      await save(pl);
      return pl;
    },
    async rename(id, name) {
      const pl = items.get(id);
      const n = cleanName(name);
      if (!pl || !n) return null;
      const next = { ...pl, name: n, updatedAt: Date.now() };
      await save(next);
      return next;
    },
    async remove(id) {
      if (!items.delete(id)) return;
      await db.del('playlists', id);
      onChange();
    },
    /** Devolve quantas faixas entraram (0 se já estavam todas). */
    async add(id, trackIds) {
      const pl = items.get(id);
      if (!pl) return 0;
      const { playlist, added } = addTracks(pl, trackIds);
      if (added) await save(playlist);
      return added;
    },
    async removeAt(id, index) {
      const pl = items.get(id);
      if (pl) await save(removeTrackAt(pl, index));
    },
    async move(id, from, to) {
      const pl = items.get(id);
      if (pl) await save(moveTrack(pl, from, to));
    },
  };
}
