// Inicialização do app: login, sincronização da biblioteca, abas, player, retomada e offline (T5 a T9).
import { handleAuthReturn, signIn, getToken, clearToken } from './auth.js';
import { createDrive } from './drive.js';
import * as db from './db.js';
import { syncLibrary, albumKey } from './library.js';
import { createLibraryUI, createPlayerUI } from './ui.js';
import { createPlayer } from './player.js';
import { serializeState, restoreState } from './queue.js';

const $ = (id) => document.getElementById(id);
const drive = createDrive({ getToken, onUnauthorized: () => { clearToken(); return null; } });
let syncing = false;

function setStatus(text) { $('status').textContent = text; }

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
let downloaded = new Set(); // IDs no store audio (os downloads chegam na T10)
const isNetworkError = (err) => err instanceof TypeError; // fetch sem rede rejeita com TypeError
function setOnline(value) {
  if (value === online) return;
  online = value;
  setStatus(online ? '' : 'Sem internet: só as músicas baixadas tocam.');
  ui.refresh();
}
addEventListener('online', () => setOnline(true));
addEventListener('offline', () => setOnline(false));
const isAvailable = (t) => online || downloaded.has(t.id);

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
  download: (id) => drive.download(id).then(
    (blob) => { setOnline(true); return blob; },
    (err) => { if (isNetworkError(err)) setOnline(false); throw err; },
  ),
  artUrl,
  fallbackArt: new URL('../proto/icon-180.png', import.meta.url).href,
  onUpdate: (s) => { updatePlayerUI(s); saveState(s); },
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
  back: $('back'),
  search: $('search'),
  tabs: document.querySelectorAll('[data-tab]'),
  getArt: db.get,
  onPlay: (t, list) => { if (canPlay(t)) player.playList(list, list.indexOf(t)); },
  onlyDownloaded: $('onlyDownloaded'),
  isDownloaded: (t) => downloaded.has(t.id),
  isAvailable,
});

async function render() {
  const tracks = await db.getAll('tracks');
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
        if (p.phase === 'tags' && p.total) setStatus(`Lendo músicas novas: ${p.done} de ${p.total}`);
      },
    });
    setOnline(true);
    const n = await render();
    const changes = [r.added && `${r.added} nova(s)`, r.changed && `${r.changed} alterada(s)`, r.removed && `${r.removed} removida(s)`].filter(Boolean);
    setStatus(`${n} música(s)${changes.length ? ` · ${changes.join(', ')}` : ' · nada mudou'}`);
  } catch (err) {
    const n = await render();
    if (isNetworkError(err)) { setOnline(false); return setStatus(`${n} música(s) · sem internet`); }
    setStatus(err.name === 'AuthError' ? 'O acesso ao Google venceu. Toque em "Entrar com Google".' : `Não deu para atualizar: ${err.message}`);
  } finally {
    syncing = false;
    refreshButtons();
  }
}

$('signin').onclick = () => {
  signIn().then(sync).catch((err) => setStatus(err.message)).finally(refreshButtons);
};
$('sync').onclick = sync;

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  db.persist().catch(() => {});
  refreshButtons();
  downloaded = new Set(await db.keys('audio').catch(() => []));
  await restorePlayer().catch(() => {}); // estado ilegível: abre com o player vazio
  const n = await render();
  if (!getToken()) return setStatus(n ? `${n} música(s) · entre para atualizar` : 'Entre com o Google para carregar suas músicas.');
  if (navigator.onLine) sync();
  else setStatus(`${n} música(s) · sem internet`);
}

// Dentro do popup de login, esta página só repassa o token e fecha.
if (!(handleAuthReturn() && window.opener)) start();
