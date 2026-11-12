// Downloads (T10): baixa faixas para o store audio, um arquivo por vez, com progresso.
// O arquivo só é gravado quando chega inteiro (e com o tamanho que o Drive informa): um download
// interrompido nunca fica marcado como baixado. Sem internet ou sem login, a fila para e espera resume().
import { AuthError } from './auth.js';

const isNetworkError = (err) => err instanceof TypeError; // fetch sem rede rejeita com TypeError
const PROGRESS_EVERY_MS = 250;

/**
 * @param {object} o
 * @param {{ get, put, del, keys }} o.db
 * @param {{ request: (path: string, params?: object) => Promise<Response> }} o.drive
 * @param {(e: { progress?: string, error?: Error }) => void} [o.onChange]  progress = só o % de uma faixa mudou
 */
export function createOffline({ db, drive, onChange = () => {} }) {
  let downloaded = new Set();
  const queue = []; // faixas esperando; queue[0] é a que está baixando
  let active = null; // { id, loaded, total }
  let error = null; // o que parou a fila (sem internet, login vencido)
  let failed = 0; // faixas puladas (ex.: não existe mais no Drive)
  let running = false;

  async function fetchWhole(track, onProgress) {
    const res = await drive.request(`files/${encodeURIComponent(track.id)}`, { alt: 'media' });
    const type = res.headers.get('content-type') || 'audio/mpeg';
    const total = Number(res.headers.get('content-length')) || Number(track.size) || 0;
    let blob;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(loaded, total);
      }
      blob = new Blob(chunks, { type });
    } else {
      blob = await res.blob();
    }
    if (track.size && blob.size !== Number(track.size)) throw new Error(`Download incompleto (${blob.size} de ${track.size} bytes).`);
    return blob;
  }

  async function run() {
    if (running) return;
    running = true;
    error = null;
    try {
      while (queue.length) {
        const t = queue[0];
        active = { id: t.id, loaded: 0, total: Number(t.size) || 0 };
        onChange({});
        let last = 0;
        try {
          const blob = await fetchWhole(t, (loaded, total) => {
            active.loaded = loaded;
            active.total = total;
            const now = Date.now();
            if (now - last >= PROGRESS_EVERY_MS) { last = now; onChange({ progress: t.id }); }
          });
          await db.put('audio', t.id, blob);
          downloaded.add(t.id);
        } catch (err) {
          if (err instanceof AuthError || isNetworkError(err)) throw err; // a faixa fica na fila
          failed++; // outro erro (404, tamanho errado): pula esta e segue com as outras
        }
        if (queue[0] === t) queue.shift();
        active = null;
        onChange({});
      }
    } catch (err) {
      error = err;
      active = null;
      onChange({ error: err });
    } finally {
      running = false;
    }
  }

  return {
    async init() { downloaded = new Set(await db.keys('audio')); },
    has: (id) => downloaded.has(id),
    get count() { return downloaded.size; },
    /** 'done' | 'active' | 'queued' | null */
    state(id) {
      if (downloaded.has(id)) return 'done';
      if (active?.id === id) return 'active';
      return queue.some((t) => t.id === id) ? 'queued' : null;
    },
    percent(id) {
      return active?.id === id && active.total ? Math.min(99, Math.floor((active.loaded / active.total) * 100)) : 0;
    },
    get status() { return { active, queued: queue.length, error, failed }; },
    /** Põe na fila o que ainda não está baixado nem na fila. Devolve quantas entraram. */
    enqueue(tracks) {
      let added = 0;
      for (const t of tracks) {
        if (downloaded.has(t.id) || queue.some((q) => q.id === t.id)) continue;
        queue.push(t);
        added++;
      }
      if (added) { failed = 0; onChange({}); run(); }
      return added;
    },
    resume() { if (queue.length) run(); },
    /** Apaga downloads e tira da fila o que ainda não começou. */
    async remove(ids) {
      for (const id of ids) {
        const i = queue.findIndex((t) => t.id === id);
        if (i > 0 || (i === 0 && !running)) queue.splice(i, 1);
        if (downloaded.has(id)) {
          await db.del('audio', id);
          downloaded.delete(id);
        }
      }
      onChange({});
    },
  };
}
