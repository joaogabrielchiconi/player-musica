// Inicialização do app: login, sincronização da biblioteca, abas e player (T5, T6, T7).
import { handleAuthReturn, signIn, getToken, clearToken } from './auth.js';
import { createDrive } from './drive.js';
import * as db from './db.js';
import { syncLibrary, albumKey } from './library.js';
import { createLibraryUI, createPlayerUI } from './ui.js';
import { createPlayer } from './player.js';

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

let updatePlayerUI = () => {};
const player = createPlayer({
  audio: $('audio'),
  download: (id) => drive.download(id),
  artUrl,
  fallbackArt: new URL('../proto/icon-180.png', import.meta.url).href,
  onUpdate: (s) => updatePlayerUI(s),
  onError: (err) => {
    setStatus(err.name === 'AuthError' ? 'O acesso ao Google venceu. Toque em "Entrar com Google".' : `Não deu para tocar: ${err.message}`);
    refreshButtons();
  },
});
updatePlayerUI = createPlayerUI({ player, artUrl, $ });

const ui = createLibraryUI({
  root: $('library'),
  title: $('title'),
  back: $('back'),
  search: $('search'),
  tabs: document.querySelectorAll('[data-tab]'),
  getArt: db.get,
  onPlay: (t, list) => player.playList(list, list.indexOf(t)),
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
    const n = await render();
    const changes = [r.added && `${r.added} nova(s)`, r.changed && `${r.changed} alterada(s)`, r.removed && `${r.removed} removida(s)`].filter(Boolean);
    setStatus(`${n} música(s)${changes.length ? ` · ${changes.join(', ')}` : ' · nada mudou'}`);
  } catch (err) {
    await render();
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
  db.persist().catch(() => {});
  refreshButtons();
  const n = await render();
  if (!getToken()) return setStatus(n ? `${n} música(s) · entre para atualizar` : 'Entre com o Google para carregar suas músicas.');
  if (navigator.onLine) sync();
  else setStatus(`${n} música(s) · sem internet`);
}

// Dentro do popup de login, esta página só repassa o token e fecha.
if (!(handleAuthReturn() && window.opener)) start();
