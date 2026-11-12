// Acesso ao Google Drive (API v3). Só leitura, exceto o appDataFolder (backup, T12).
// Dependências injetadas para os testes rodarem no Node com um fetch falso.
import { AuthError } from './auth.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav)$/i;

export class DriveError extends Error {
  constructor(status, message) { super(message || `Erro do Drive (${status}).`); this.name = 'DriveError'; this.status = status; }
}

export const isAudio = (f) => f.mimeType !== FOLDER && (f.mimeType?.startsWith('audio/') || AUDIO_EXT.test(f.name));
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * @param {object} deps
 * @param {() => string|null} deps.getToken token atual ou null
 * @param {() => Promise<string|null>|string|null} [deps.onUnauthorized] chamado no 401; se devolver token novo, repete uma vez
 * @param {typeof fetch} [deps.fetch]
 */
export function createDrive({ getToken, onUnauthorized = () => null, fetch: fetchFn = globalThis.fetch.bind(globalThis) }) {
  const withParams = (base, params) => `${base}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
  const request = (path, params = {}, headers = {}) => send(withParams(`${API}/${path}`, params), { headers });

  // Toda chamada passa aqui: põe o token e, no 401, renova uma vez e repete.
  async function send(url, init) {
    let token = getToken();
    if (!token) throw new AuthError();
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        token = attempt === 0 ? await onUnauthorized() : null;
        if (!token) throw new AuthError('O acesso ao Google expirou. Entre de novo.');
        continue;
      }
      if (!res.ok) throw new DriveError(res.status, await res.text().catch(() => ''));
      return res;
    }
  }

  async function listChildren(folderId) {
    const files = [];
    let pageToken;
    do {
      const res = await request('files', {
        q: `${quote(folderId)} in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime)',
        pageSize: '1000',
        ...(pageToken && { pageToken }),
      });
      const data = await res.json();
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }

  // Todas as faixas da pasta e das subpastas. `folder` é o caminho da subpasta ('' na raiz).
  async function listAudio(folderId, folder = '') {
    const tracks = [];
    for (const f of await listChildren(folderId)) {
      if (f.mimeType === FOLDER) tracks.push(...await listAudio(f.id, folder ? `${folder}/${f.name}` : f.name));
      else if (isAudio(f)) tracks.push({ ...f, size: Number(f.size ?? 0), folder });
    }
    return tracks;
  }

  // ID da pasta pelo nome, na raiz do Meu Drive. null se não existir.
  async function findFolder(name = 'Músicas') {
    const res = await request('files', {
      q: `name = ${quote(name)} and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`,
      fields: 'files(id, name)',
    });
    const { files = [] } = await res.json();
    return files[0]?.id ?? null;
  }

  const download = (id) => request(`files/${encodeURIComponent(id)}`, { alt: 'media' }).then((r) => r.blob());

  // Bytes [start, end] inclusive. O Drive responde 206 com só esse trecho.
  const downloadRange = (id, start, end) =>
    request(`files/${encodeURIComponent(id)}`, { alt: 'media' }, { Range: `bytes=${start}-${end}` }).then((r) => r.arrayBuffer());

  // ---- appDataFolder (T12): pasta escondida que só este app vê. É a ÚNICA escrita no Drive. ----
  // Só atualiza arquivo cujo ID veio de uma listagem do appDataFolder (ou que este app criou lá);
  // qualquer outro ID é recusado antes de chegar à rede.
  const appDataIds = new Set();

  /** Arquivo do appDataFolder pelo nome (o mais recente), ou null. */
  async function findAppData(name) {
    const res = await request('files', {
      spaces: 'appDataFolder',
      q: `name = ${quote(name)} and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '10',
    });
    const { files = [] } = await res.json();
    for (const f of files) appDataIds.add(f.id);
    return files[0] ?? null;
  }

  const readAppData = (id) => request(`files/${encodeURIComponent(id)}`, { alt: 'media' }).then((r) => r.text());

  /** Grava texto JSON no appDataFolder: atualiza `id` (se dado) ou cria o arquivo. Devolve o ID. */
  async function writeAppData(name, text, id = null) {
    if (id) {
      if (!appDataIds.has(id)) throw new Error('Gravação recusada: o arquivo não é do appDataFolder deste app.');
      await send(withParams(`${UPLOAD}/files/${encodeURIComponent(id)}`, { uploadType: 'media' }),
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      return id;
    }
    const boundary = `b${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await send(withParams(`${UPLOAD}/files`, { uploadType: 'multipart', fields: 'id' }),
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    const { id: created } = await res.json();
    appDataIds.add(created);
    return created;
  }

  return { request, listChildren, listAudio, findFolder, download, downloadRange, findAppData, readAppData, writeAppData };
}
