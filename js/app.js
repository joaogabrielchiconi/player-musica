// Inicialização do app: login, sincronização da biblioteca e abas (T5, T6).
import { handleAuthReturn, signIn, getToken, clearToken } from './auth.js';
import { createDrive } from './drive.js';
import * as db from './db.js';
import { syncLibrary } from './library.js';
import { createLibraryUI } from './ui.js';

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

// shortcut: toca só a faixa tocada, sem fila nem próxima com a tela bloqueada; a T7 troca por js/player.js (receita do protótipo v4).
const audio = $('audio');
let playingId = null;
async function play(t) {
  if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
  playingId = t.id;
  $('now').hidden = false;
  $('nowTitle').textContent = `Carregando: ${t.title}`;
  try {
    const blob = await drive.download(t.id);
    if (playingId !== t.id) return; // tocou em outra enquanto baixava
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(blob);
    await audio.play();
    $('nowTitle').textContent = `${t.title} · ${t.artist}`;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
  } catch (err) {
    $('nowTitle').textContent = err.name === 'AuthError' ? 'O acesso ao Google venceu. Toque em "Entrar com Google".' : `Não deu para tocar: ${err.message}`;
    refreshButtons();
  }
}
$('nowToggle').onclick = () => (audio.paused ? audio.play() : audio.pause());
audio.onplay = () => { $('nowToggle').textContent = '⏸'; $('nowToggle').ariaLabel = 'Pausar'; };
audio.onpause = () => { $('nowToggle').textContent = '▶︎'; $('nowToggle').ariaLabel = 'Tocar'; };

const ui = createLibraryUI({
  root: $('library'),
  title: $('title'),
  back: $('back'),
  search: $('search'),
  tabs: document.querySelectorAll('[data-tab]'),
  getArt: db.get,
  onPlay: play,
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
