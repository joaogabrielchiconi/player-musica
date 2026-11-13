// Inicialização do app: login, sincronização da biblioteca, abas, player, retomada, offline, downloads, playlists e backup (T5 a T12).
import { handleAuthReturn, signIn, getToken, clearToken } from './auth.js';
import { createDrive } from './drive.js';
import * as db from './db.js';
import { syncLibrary, albumKey } from './library.js';
import { createLibraryUI, createPlayerUI } from './ui.js';
import { createPlayer } from './player.js';
import { serializeState, restoreState } from './queue.js';
import { createOffline } from './offline.js';
import { createPlaylists, tracksOf, createPlaylistBackup } from './playlists.js';
import { confirmDialog } from './dialogs.js';

const $ = (id) => document.getElementById(id);
document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS: pinça de zoom no app inteiro
const drive = createDrive({ getToken, onUnauthorized: () => { clearToken(); return null; } });
let syncing = false;

function setStatus(text) { $('status').textContent = text; }

// Barra fina do cabeçalho enquanto lê as músicas novas (fração de 0 a 1; null esconde).
function setSyncBar(fraction) {
  const bar = $('syncbar');
  bar.hidden = fraction == null;
  if (fraction == null) return;
  bar.style.setProperty('--w', `${Math.round(fraction * 100)}%`);
  bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
}

function refreshButtons() {
  const signedIn = Boolean(getToken());
  $('signin').hidden = signedIn;
  $('sync').hidden = !signedIn;
  $('sync').disabled = syncing;
}

// Capa do álbum como URL (fica na memória enquanto o app está aberto).
const artUrls = new Map();
async function artUrl(t) {
  const key = albumKey(t.artist, t.album);
  if (!artUrls.has(key)) {
    const blob = await db.get('art', key);
    artUrls.set(key, blob ? URL.createObjectURL(blob) : null);
  }
  return artUrls.get(key);
}

// Estado do player (T8): salva a cada ~5 s tocando e, na hora, ao trocar de faixa, pausar, mudar a fila ou sair.
const SAVE_EVERY_MS = 5000;
let lastSave = 0;
let lastKey = '';
function saveState(s, force = false) {
  if (!s.track) return; // player vazio não apaga o que já estava salvo
  const key = `${s.queue.pos}|${s.queue.shuffle}|${s.queue.repeat}|${s.playing}|${s.queue.order.length}`;
  const now = Date.now();
  if (!force && key === lastKey && !(s.playing && now - lastSave >= SAVE_EVERY_MS)) return;
  lastKey = key;
  lastSave = now;
  db.put('state', 'player', serializeState(s.queue, s.time, s.duration)).catch(() => {});
}
// O iOS pode encerrar o app em segundo plano sem avisar: o último ponto é gravado quando a tela some.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveState(player.state, true); });
addEventListener('pagehide', () => saveState(player.state, true));

async function restorePlayer() {
  const [raw, tracks] = await Promise.all([db.get('state', 'player'), db.getAll('tracks')]);
  const r = restoreState(raw, new Map(tracks.map((t) => [t.id, t])));
  if (r) player.restore(r.q, r.time, r.duration);
}

// ---- internet (T9): navigator.onLine e também a falha de uma chamada ----
let online = navigator.onLine;
const isNetworkError = (err) => err instanceof TypeError; // fetch sem rede rejeita com TypeError
function setOnline(value) {
  if (value === online) return;
  online = value;
  $('net').hidden = online;
  setStatus(online ? '' : 'Sem internet: só as músicas baixadas tocam.');
  if (online) {
    offline.resume(); // downloads parados pela queda continuam
    backup.sync().catch(() => {}); // e o backup pendente das playlists
  }
  ui.refresh();
}
addEventListener('online', () => setOnline(true));
addEventListener('offline', () => setOnline(false));
const isAvailable = (t) => online || offline.has(t.id);

// ---- playlists (T11) ----
let library = []; // faixas do banco, para nomes no painel, espaço usado e playlists
let libraryById = new Map();
const playlistStore = createPlaylists({ db, onChange: () => { ui.refresh(); backup.changed().catch(() => {}); } });
// Backup no Drive (T12): grava ~3 s depois de cada mudança; restaura depois de sincronizar a biblioteca.
const backup = createPlaylistBackup({
  store: playlistStore,
  drive,
  db,
  libraryIds: async () => new Set(await db.keys('tracks')),
  onRestored: ({ playlists: n, droppedTracks }) => setStatus(`${n} playlist(s) restaurada(s) do backup no Drive.`
    + (droppedTracks ? ` ${droppedTracks} música(s) não existem mais no Drive e ficaram de fora.` : '')),
  onError: (err) => { if (isNetworkError(err)) setOnline(false); },
});
const playlists = {
  list: playlistStore.list,
  get: playlistStore.get,
  create: playlistStore.create,
  rename: playlistStore.rename,
  remove: playlistStore.remove,
  add: playlistStore.add,
  removeAt: playlistStore.removeAt,
  move: playlistStore.move,
  tracksOf: (pl) => tracksOf(pl, libraryById),
};

// ---- downloads (T10) ----
const offline = createOffline({
  db,
  drive,
  onChange: (e) => {
    if (e.error && isNetworkError(e.error)) setOnline(false);
    if (e.progress) ui.updateDownload(e.progress);
    else ui.refresh();
  },
});
const fmtBytes = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);
const downloads = {
  state: (id) => offline.state(id),
  percent: (id) => offline.percent(id),
  add(list) {
    if (!online) return toast('Sem internet: não dá para baixar agora.');
    if (!getToken()) return toast('Entre com o Google para baixar.');
    const n = offline.enqueue(list);
    toast(n ? `${n} música(s) na fila para baixar.` : 'Já está tudo baixado.');
  },
  async toggle(t) {
    const s = offline.state(t.id);
    if (s === 'done') {
      const ok = await confirmDialog({ title: `Apagar o download de "${t.title}"?`, text: 'A música continua na biblioteca. Para ouvir sem internet, é preciso baixar de novo.', confirmLabel: 'Apagar download' });
      if (ok) offline.remove([t.id]);
    } else if (s === 'queued') offline.remove([t.id]);
    else if (!s) downloads.add([t]);
  },
  async removeAll(list) {
    const ids = list.filter((t) => offline.has(t.id)).map((t) => t.id);
    if (!ids.length) return;
    const ok = await confirmDialog({ title: `Apagar ${ids.length} download(s)?`, text: 'As músicas continuam na biblioteca. Para ouvir sem internet, vai precisar baixar de novo.', confirmLabel: 'Apagar downloads' });
    if (ok) offline.remove(ids);
  },
  progressText() {
    const { active, queued, error, failed } = offline.status;
    if (error) {
      return error.name === 'AuthError'
        ? `Downloads parados: entre com o Google para continuar (${queued} na fila).`
        : `Downloads parados: sem internet (${queued} na fila). Continuam quando a internet voltar.`;
    }
    if (active) {
      const t = library.find((x) => x.id === active.id);
      return `Baixando ${t ? `"${t.title}" ` : ''}${offline.percent(active.id)}%${queued > 1 ? ` · mais ${queued - 1} na fila` : ''}`;
    }
    return failed ? `${failed} música(s) não baixaram (talvez tenham saído do Drive).` : '';
  },
  async spaceText() {
    const mine = library.filter((t) => offline.has(t.id));
    let text = `Downloads: ${fmtBytes(mine.reduce((s, t) => s + (Number(t.size) || 0), 0))} em ${mine.length} música(s)`;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est?.quota) text += ` · o app usa ${fmtBytes(est.usage || 0)} de ${fmtBytes(est.quota)} liberados pelo iPhone`;
    return text;
  },
};

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2500);
}
const OFFLINE_MSG = 'Sem internet: esta música não foi baixada.';
function canPlay(t) {
  if (isAvailable(t)) return true;
  toast(OFFLINE_MSG);
  return false;
}

let updatePlayerUI = () => {};
const player = createPlayer({
  audio: $('audio'),
  // Baixada: vem do banco (sem internet e sem login). Senão, pela internet.
  download: async (id) => (offline.has(id) && await db.get('audio', id)) || drive.download(id).then(
    (blob) => { setOnline(true); return blob; },
    (err) => { if (isNetworkError(err)) setOnline(false); throw err; },
  ),
  artUrl,
  fallbackArt: new URL('../proto/icon-180.png', import.meta.url).href,
  onUpdate: (s) => { updatePlayerUI(s); saveState(s); ui.setNowPlaying(s.track?.id ?? null, s.playing); },
  onError: (err) => {
    if (isNetworkError(err)) return toast(OFFLINE_MSG);
    setStatus(err.name === 'AuthError' ? 'O acesso ao Google venceu. Toque em "Entrar com Google".' : `Não deu para tocar: ${err.message}`);
    refreshButtons();
  },
});
updatePlayerUI = createPlayerUI({ player, artUrl, $, canPlay });

const ui = createLibraryUI({
  root: $('library'),
  title: $('title'),
  countEl: $('count'),
  back: $('back'),
  search: $('search'),
  tabs: document.querySelectorAll('[data-tab]'),
  getArt: db.get,
  onPlay: (t, list) => {
    if (!canPlay(t)) return;
    const playable = online ? list : list.filter(isAvailable); // sem internet a fila só tem as baixadas
    player.playList(playable, playable.indexOf(t));
  },
  onlyDownloaded: $('onlyDownloaded'),
  isDownloaded: (t) => offline.has(t.id),
  isAvailable,
  downloads,
  playlists,
  toast,
});

async function render() {
  const tracks = await db.getAll('tracks');
  library = tracks;
  libraryById = new Map(tracks.map((t) => [t.id, t]));
  ui.setTracks(tracks);
  return tracks.length;
}

async function sync() {
  if (syncing) return;
  syncing = true;
  refreshButtons();
  try {
    const r = await syncLibrary({
      drive,
      db,
      onProgress: (p) => {
        if (p.phase === 'listing') setStatus('Conferindo a pasta Músicas no Drive…');
        if (p.phase === 'tags' && p.total) {
          setStatus(`Lendo músicas novas: ${p.done} de ${p.total}`);
          setSyncBar(p.done / p.total);
        }
      },
    });
    setOnline(true);
    const n = await render();
    const changes = [r.added && `${r.added} nova(s)`, r.changed && `${r.changed} alterada(s)`, r.removed && `${r.removed} removida(s)`].filter(Boolean);
    setStatus(`${n} música(s)${changes.length ? ` · ${changes.join(', ')}` : ' · nada mudou'}`);
    // Biblioteca completa: agora dá para conferir/restaurar o backup das playlists e gravar o pendente.
    backup.sync({ canRestore: true }).catch((err) => { if (isNetworkError(err)) setOnline(false); });
  } catch (err) {
    const n = await render();
    if (isNetworkError(err)) { setOnline(false); return setStatus(`${n} música(s) · sem internet`); }
    setStatus(err.name === 'AuthError' ? 'O acesso ao Google venceu. Toque em "Entrar com Google".' : `Não deu para atualizar: ${err.message}`);
  } finally {
    syncing = false;
    setSyncBar(null);
    refreshButtons();
  }
}

$('signin').onclick = () => {
  signIn().then(() => { offline.resume(); return sync(); }).catch((err) => setStatus(err.message)).finally(refreshButtons);
};
$('sync').onclick = sync;

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  db.persist().catch(() => {});
  refreshButtons();
  await offline.init().catch(() => {});
  await playlistStore.init().catch(() => {}); // banco ilegível: abre sem playlists, sem quebrar o resto
  await restorePlayer().catch(() => {}); // estado ilegível: abre com o player vazio
  const n = await render();
  if (!getToken()) return setStatus(n ? `${n} música(s) · entre para atualizar` : 'Entre com o Google para carregar suas músicas.');
  if (navigator.onLine) sync();
  else setStatus(`${n} música(s) · sem internet`);
}

// Dentro do popup de login, esta página só repassa o token e fecha.
if (!(handleAuthReturn() && window.opener)) start();
