// Inicialização do app. T5: login, sincronização da biblioteca e lista simples (as abas vêm na T6).
import { handleAuthReturn, signIn, getToken, clearToken } from './auth.js';
import { createDrive } from './drive.js';
import * as db from './db.js';
import { syncLibrary } from './library.js';

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

async function render() {
  const tracks = await db.getAll('tracks');
  tracks.sort((a, b) => a.artist.localeCompare(b.artist, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR'));
  const list = $('tracks');
  list.textContent = '';
  for (const t of tracks) {
    const li = document.createElement('li');
    const title = Object.assign(document.createElement('span'), { className: 'title', textContent: t.title });
    const sub = Object.assign(document.createElement('span'), { className: 'sub', textContent: `${t.artist} · ${t.album}` });
    li.append(title, sub);
    if (t.removedFromDrive) li.append(Object.assign(document.createElement('span'), { className: 'sub removed', textContent: 'removida do Drive' }));
    list.append(li);
  }
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
