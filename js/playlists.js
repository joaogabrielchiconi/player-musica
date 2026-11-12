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
    /** Junta playlists de fora (backup) que ainda não existem aqui. Devolve quantas entraram. */
    async merge(list) {
      let n = 0;
      for (const raw of list) {
        const pl = sanitize(raw);
        if (!pl || items.has(pl.id)) continue;
        items.set(pl.id, pl);
        await db.put('playlists', pl.id, pl);
        n++;
      }
      if (n) onChange();
      return n;
    },
  };
}

// ---- backup no Drive (T12): um playlists.json no appDataFolder ----
export const BACKUP_FILE = 'playlists.json';
const META_DIRTY = 'playlistsBackupDirty'; // carimbo da última mudança ainda não gravada (ou false)
const META_CHECKED = 'playlistsRestoreChecked'; // já conferiu o backup nesta instalação

export const toBackup = (list, now = Date.now()) => ({
  version: 1,
  savedAt: now,
  playlists: list.map(({ id, name, trackIds, createdAt, updatedAt }) => ({ id, name, trackIds, createdAt, updatedAt })),
});

/** Backup -> playlists válidas, ou null se o formato não for reconhecido. */
export function fromBackup(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.playlists)) return null;
  return raw.playlists.map(sanitize).filter(Boolean);
}

/** Playlists do backup que faltam aqui, sem as faixas que não existem mais na biblioteca. */
export function planRestore(local, backup, libraryIds) {
  const have = new Set(local.map((p) => p.id));
  let droppedTracks = 0;
  const add = [];
  for (const pl of backup) {
    if (have.has(pl.id)) continue;
    const trackIds = pl.trackIds.filter((id) => libraryIds.has(id));
    droppedTracks += pl.trackIds.length - trackIds.length;
    add.push({ ...pl, trackIds });
  }
  return { add, droppedTracks };
}

/**
 * Backup e restauração. Regra de segurança: só grava depois de ter conferido o backup que já existe
 * (uma vez por instalação, com a biblioteca completa). Assim, um app recém-instalado nunca sobrescreve
 * as playlists salvas com uma lista vazia.
 * @param {object} o
 * @param {ReturnType<typeof createPlaylists>} o.store
 * @param {{ findAppData, readAppData, writeAppData }} o.drive
 * @param {{ get, put }} o.db                       store meta guarda o estado do backup
 * @param {() => Promise<Set<string>>} o.libraryIds  IDs das faixas da biblioteca
 * @param {(r: { playlists: number, droppedTracks: number }) => void} [o.onRestored]
 * @param {(err: Error) => void} [o.onError]
 */
export function createPlaylistBackup({ store, drive, db, libraryIds, onRestored = () => {}, onError = () => {}, delayMs = 3000 }) {
  let fileId = null;
  let timer = null;
  let running = null;

  async function checkRestore() {
    const ids = await libraryIds();
    if (!ids.size) return false; // biblioteca vazia: tudo pareceria "faixa que não existe mais"
    const f = await drive.findAppData(BACKUP_FILE);
    if (f) {
      fileId = f.id;
      let backup = null;
      try { backup = fromBackup(JSON.parse(await drive.readAppData(f.id))); } catch (err) {
        if (!(err instanceof SyntaxError)) throw err; // sem internet/login: tenta de novo depois
      }
      if (backup) {
        const { add, droppedTracks } = planRestore(store.list(), backup, ids);
        const n = await store.merge(add);
        if (n) onRestored({ playlists: n, droppedTracks });
      }
    }
    await db.put('meta', META_CHECKED, true);
    return true;
  }

  async function flush() {
    const stamp = await db.get('meta', META_DIRTY);
    if (!stamp) return;
    const text = JSON.stringify(toBackup(store.list()));
    if (!fileId) fileId = (await drive.findAppData(BACKUP_FILE))?.id ?? null;
    try {
      fileId = await drive.writeAppData(BACKUP_FILE, text, fileId);
    } catch (err) {
      if (err.status !== 404) throw err;
      fileId = await drive.writeAppData(BACKUP_FILE, text, null); // o arquivo sumiu: cria de novo
    }
    // Mudou de novo enquanto gravava? Fica pendente para a próxima rodada.
    if ((await db.get('meta', META_DIRTY)) === stamp) await db.put('meta', META_DIRTY, false);
  }

  /** canRestore: true só depois de sincronizar a biblioteca inteira. */
  function sync({ canRestore = false } = {}) {
    running ??= (async () => {
      try {
        const checked = (await db.get('meta', META_CHECKED)) || (canRestore && await checkRestore());
        if (checked) await flush();
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    sync,
    /** Chamar a cada mudança de playlist: grava ~3 s depois da última. */
    async changed() {
      await db.put('meta', META_DIRTY, Date.now());
      clearTimeout(timer);
      timer = setTimeout(() => sync().catch(onError), delayMs);
    },
  };
}
