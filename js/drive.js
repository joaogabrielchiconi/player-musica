// Acesso ao Google Drive (API v3). Só leitura, exceto o appDataFolder (backup, T12).
// Dependências injetadas para os testes rodarem no Node com um fetch falso.
import { AuthError } from './auth.js';

const API = 'https://www.googleapis.com/drive/v3';
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
  async function request(path, params = {}, headers = {}) {
    const url = `${API}/${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    let token = getToken();
    if (!token) throw new AuthError();
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
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

  return { request, listChildren, listAudio, findFolder, download, downloadRange };
}
