// Protótipo descartável (T1): prova login no app instalado, listagem do Drive e
// reprodução em sequência com a tela bloqueada. Não reaproveitar sem revisar.
import { GOOGLE_CLIENT_ID } from '../js/config.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.appdata';
const REDIRECT_URI = new URL('./', location.href).href; // precisa bater com o URI cadastrado no Google
const API = 'https://www.googleapis.com/drive/v3';
const $ = (id) => document.getElementById(id);
const audio = $('audio');

// ---------- registro persistente (para ler o que aconteceu com a tela bloqueada) ----------
const LOG_KEY = 'proto_log';
function log(msg) {
  const line = `${new Date().toLocaleTimeString('pt-BR')} [${document.visibilityState}] ${msg}`;
  let lines = [];
  try { lines = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch {}
  lines.push(line);
  lines = lines.slice(-200);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch {}
  $('log').textContent = lines.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}
$('clearLog').onclick = () => { localStorage.removeItem(LOG_KEY); $('log').textContent = ''; };
try { $('log').textContent = JSON.parse(localStorage.getItem(LOG_KEY) || '[]').join('\n'); } catch {}

const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
$('mode').textContent = standalone ? 'Modo: app instalado (Tela de Início)' : 'Modo: Safari (não instalado)';
document.addEventListener('visibilitychange', () => log(`visibilidade: ${document.visibilityState}`));

// ---------- login ----------
function getToken() {
  const t = JSON.parse(localStorage.getItem('proto_token') || 'null');
  return t && t.expiresAt > Date.now() + 30_000 ? t.value : null;
}
function saveToken(value, expiresIn, via) {
  localStorage.setItem('proto_token', JSON.stringify({ value, expiresAt: Date.now() + expiresIn * 1000 }));
  log(`login OK via ${via} (expira em ${Math.round(expiresIn / 60)} min)`);
  refreshButtons();
}
function authUrl(state) {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'token',
    scope: SCOPES, include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
function newState(via) {
  const state = `${via}.${crypto.randomUUID()}`;
  localStorage.setItem('proto_oauth_state', state);
  return state;
}

// Volta do Google: o token vem no fragmento (#access_token=...).
function handleRedirectReturn() {
  if (!location.hash.includes('access_token') && !location.hash.includes('error')) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  const state = p.get('state') || '';
  const via = state.split('.')[0] || '?';
  if (p.get('error')) { log(`login falhou (${via}): ${p.get('error')}`); return true; }
  if (state !== localStorage.getItem('proto_oauth_state')) { log(`login recusado: state não confere (${via})`); return true; }
  localStorage.removeItem('proto_oauth_state');
  const token = p.get('access_token'), expiresIn = Number(p.get('expires_in') || 3600);
  if (via === 'popup' && window.opener) {
    window.opener.postMessage({ token, expiresIn }, location.origin);
    log('popup: token enviado ao app, fechando');
    window.close();
  }
  saveToken(token, expiresIn, via === 'popup' ? 'popup (aberto na própria janela)' : 'redirecionamento');
  return true;
}

$('loginRedirect').onclick = () => { log('abrindo login (redirecionamento)'); location.href = authUrl(newState('redirect')); };
$('loginPopup').onclick = () => {
  log('abrindo login (popup)');
  const w = window.open(authUrl(newState('popup')), 'oauth', 'width=500,height=650');
  if (!w) log('popup bloqueado pelo navegador');
};
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data?.token) return;
  saveToken(e.data.token, e.data.expiresIn, 'popup (postMessage)');
});
// Se o popup não tiver window.opener, ele grava no localStorage; o evento storage avisa esta janela.
window.addEventListener('storage', (e) => { if (e.key === 'proto_token' && e.newValue) { log('token chegou via storage'); refreshButtons(); } });

// ---------- Drive ----------
async function drive(path, params = {}, init = {}) {
  const token = getToken();
  if (!token) throw new Error('sem token: entre de novo');
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) { localStorage.removeItem('proto_token'); refreshButtons(); throw new Error('token expirado: entre de novo'); }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res;
}
async function listChildren(folderId) {
  const out = [];
  let pageToken;
  do {
    const res = await drive('files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)', pageSize: '1000', orderBy: 'name',
      ...(pageToken && { pageToken }),
    });
    const data = await res.json();
    out.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}
async function listAudioRecursive(folderId, prefix = '') {
  const tracks = [];
  for (const f of await listChildren(folderId)) {
    if (f.mimeType === 'application/vnd.google-apps.folder') tracks.push(...await listAudioRecursive(f.id, `${prefix}${f.name}/`));
    else if (f.mimeType.startsWith('audio/') || /\.(mp3|m4a|aac|flac)$/i.test(f.name)) tracks.push({ ...f, path: prefix + f.name });
  }
  return tracks;
}

let tracks = [];
$('list').onclick = async () => {
  try {
    log('procurando pasta Músicas na raiz');
    const res = await drive('files', {
      q: "name = 'Músicas' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
      fields: 'files(id, name)',
    });
    const { files } = await res.json();
    if (!files.length) return log('pasta Músicas não encontrada na raiz do Drive');
    tracks = await listAudioRecursive(files[0].id);
    log(`${tracks.length} faixa(s) encontrada(s)`);
    renderTracks();
  } catch (err) { log(`erro: ${err.message}`); }
};

// ---------- reprodução ----------
let index = -1;
let currentUrl = null;
let prefetch = null; // { index, promise }
const mb = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;

function renderTracks() {
  $('tracks').innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = `${t.path} (${mb(t.size)})`;
    li.className = i === index ? 'now' : '';
    li.onclick = () => playIndex(i, 'toque na lista');
    $('tracks').append(li);
  });
  refreshButtons();
}
function fetchBlob(i) {
  const t0 = performance.now();
  return drive(`files/${tracks[i].id}`, { alt: 'media' })
    .then((r) => r.blob())
    .then((blob) => { log(`baixou faixa ${i + 1} em ${((performance.now() - t0) / 1000).toFixed(1)} s (${mb(blob.size)})`); return blob; });
}
function startPrefetch(i) {
  if (i < 0 || i >= tracks.length || prefetch?.index === i) return;
  log(`pré-carregando faixa ${i + 1}`);
  prefetch = { index: i, promise: fetchBlob(i) };
  prefetch.promise.catch((err) => { log(`erro no pré-carregamento: ${err.message}`); prefetch = null; });
}

async function playIndex(i, reason) {
  if (i < 0 || i >= tracks.length) { log('fim da fila'); return; }
  const t0 = performance.now();
  index = i;
  renderTracks();
  log(`faixa ${i + 1} (${reason})`);
  try {
    const blob = await (prefetch?.index === i ? prefetch.promise : fetchBlob(i));
    if (index !== i) return; // usuário pulou para outra faixa enquanto baixava
    prefetch = null;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    audio.src = currentUrl;
    audio.addEventListener('playing', () => log(`tocando faixa ${i + 1}: ${((performance.now() - t0) / 1000).toFixed(1)} s desde o pedido`), { once: true });
    setMediaSession(tracks[i]);
    await audio.play();
  } catch (err) { log(`erro ao tocar faixa ${i + 1}: ${err.message}`); }
}

audio.addEventListener('playing', () => startPrefetch(index + 1));
audio.addEventListener('ended', () => { log(`terminou faixa ${index + 1}`); playIndex(index + 1, 'fim da anterior'); });
audio.addEventListener('pause', () => { if (!audio.ended) log('pausado'); });
audio.addEventListener('error', () => log(`erro do <audio>: ${audio.error?.code}`));
audio.addEventListener('timeupdate', () => {
  if (!('setPositionState' in navigator.mediaSession) || !audio.duration) return;
  try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 }); } catch {}
});

function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return log('Media Session não disponível');
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.name.replace(/\.[^.]+$/, ''), artist: 'Protótipo', album: t.path.split('/').slice(-2, -1)[0] || 'Músicas',
    artwork: [{ src: new URL('icon-180.png', location.href).href, sizes: '180x180', type: 'image/png' }],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => { log('tela de bloqueio: play'); audio.play(); });
  ms.setActionHandler('pause', () => { log('tela de bloqueio: pause'); audio.pause(); });
  ms.setActionHandler('nexttrack', () => playIndex(index + 1, 'tela de bloqueio: próxima'));
  ms.setActionHandler('previoustrack', () => {
    if (audio.currentTime > 3) { audio.currentTime = 0; log('tela de bloqueio: voltou ao início'); }
    else playIndex(Math.max(0, index - 1), 'tela de bloqueio: anterior');
  });
  try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch {}
}

$('playAll').onclick = () => playIndex(0, 'tocar tudo');

function refreshButtons() {
  const ok = !!getToken();
  $('list').disabled = !ok;
  $('playAll').disabled = !ok || !tracks.length;
}

// ---------- início ----------
if (!GOOGLE_CLIENT_ID) log('falta GOOGLE_CLIENT_ID em js/config.js');
handleRedirectReturn();
refreshButtons();
