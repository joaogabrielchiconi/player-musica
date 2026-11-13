// Biblioteca local: compara o Drive com o banco e grava só o que mudou.
import { readTags } from './tags.js';

const FOLDER_NAME = 'Músicas';

export const albumKey = (artist, album) => `${artist}\u0000${album}`.toLowerCase();

// ---- agrupar, ordenar e buscar (puras: a interface só desenha o que sai daqui) ----
const cmp = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });

// Sem acento e sem maiúscula: "José" e "jose" ficam iguais.
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const sortTracks = (tracks) => [...tracks].sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));

// Faixa do álbum em ordem: número da faixa primeiro; sem número, vai para o fim, por título.
const byTrackNo = (a, b) => (a.trackNo ?? Infinity) - (b.trackNo ?? Infinity) || cmp(a.title, b.title);

export function groupByAlbum(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = albumKey(t.artist, t.album);
    if (!map.has(key)) map.set(key, { key, album: t.album, artist: t.artist, hasArt: false, tracks: [] });
    const g = map.get(key);
    g.tracks.push(t);
    g.hasArt ||= Boolean(t.hasArt);
  }
  for (const g of map.values()) g.tracks.sort(byTrackNo);
  return [...map.values()].sort((a, b) => cmp(a.album, b.album) || cmp(a.artist, b.artist));
}

export function groupByArtist(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const key = t.artist.toLowerCase();
    if (!map.has(key)) map.set(key, { key, artist: t.artist, tracks: [] });
    map.get(key).tracks.push(t);
  }
  const out = [...map.values()].sort((a, b) => cmp(a.artist, b.artist));
  for (const g of out) g.albums = groupByAlbum(g.tracks);
  return out;
}

export function searchTracks(tracks, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => {
    const text = normalize(`${t.title} ${t.artist} ${t.album}`);
    return words.every((w) => text.includes(w));
  });
}

// Mesmo arquivo sem mudança: mesmo nome, mesma pasta e mesmo conteúdo (md5, ou data se não houver md5).
const unchangedFile = (t, f) =>
  !t.removedFromDrive && t.name === f.name && t.folder === f.folder &&
  (f.md5Checksum ? t.md5 === f.md5Checksum : t.modifiedTime === f.modifiedTime);

// Separa a listagem do Drive em novas, alteradas (ou que voltaram) e removidas.
export function diffLibrary(driveFiles, localTracks) {
  const local = new Map(localTracks.map((t) => [t.id, t]));
  const seen = new Set();
  const added = [];
  const changed = [];
  for (const f of driveFiles) {
    seen.add(f.id);
    const t = local.get(f.id);
    if (!t) added.push(f);
    else if (!unchangedFile(t, f)) changed.push(f);
  }
  const removed = localTracks.filter((t) => !seen.has(t.id));
  return { added, changed, removed };
}

/**
 * Sincroniza a pasta "Músicas" com o banco. Pode ser interrompida (sem internet, login vencido)
 * e repetida: o que já foi gravado fica, e a próxima rodada continua do ponto em que parou.
 * @param {object} o
 * @param {object} o.drive  createDrive(...)
 * @param {object} o.db     { get, put, del, getAll } de db.js
 * @param {(p: {phase: string, done?: number, total?: number}) => void} [o.onProgress]
 */
export async function syncLibrary({ drive, db, onProgress = () => {}, concurrency = 4 }) {
  onProgress({ phase: 'listing' });
  // Procura a pasta a cada sincronização: se ela for apagada e recriada, o ID muda.
  const folderId = await drive.findFolder(FOLDER_NAME);
  if (!folderId) throw new Error(`A pasta "${FOLDER_NAME}" não foi encontrada na raiz do seu Google Drive.`);
  await db.put('meta', 'folderId', folderId);

  const files = await drive.listAudio(folderId);
  const { added, changed, removed } = diffLibrary(files, await db.getAll('tracks'));
  const queue = [...added, ...changed];
  const total = queue.length;
  let done = 0;
  onProgress({ phase: 'tags', done, total });

  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const tags = await readTags(f, drive);
      if (tags.art) await db.put('art', albumKey(tags.artist, tags.album), tags.art);
      await db.put('tracks', f.id, {
        id: f.id,
        name: f.name,
        folder: f.folder,
        size: f.size,
        md5: f.md5Checksum ?? null,
        modifiedTime: f.modifiedTime ?? null,
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        trackNo: tags.trackNo ?? null,
        hasArt: Boolean(tags.art),
        removedFromDrive: false,
      });
      onProgress({ phase: 'tags', done: ++done, total });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));

  // Tirou do Drive = não quer mais: some da biblioteca e do celular (capas ficam, são por álbum).
  for (const t of removed) {
    await db.del('tracks', t.id);
    await db.del('audio', t.id);
  }
  await db.put('meta', 'lastSync', Date.now());

  onProgress({ phase: 'done' });
  return { total: files.length, added: added.length, changed: changed.length, removed: removed.length, removedIds: removed.map((t) => t.id) };
}
