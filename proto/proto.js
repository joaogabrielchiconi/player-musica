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

// ---------- experimentos (v2): som mudo na troca de faixa com a tela bloqueada ----------
const VERSION = 'v2';
const OPTS = { optSession: ['opt_session', true], optTwo: ['opt_two', false] };
const opts = {};
for (const [id, [key, def]] of Object.entries(OPTS)) {
  const v = localStorage.getItem(key);
  opts[id] = v === null ? def : v === '1';
  $(id).checked = opts[id];
  $(id).onchange = () => { opts[id] = $(id).checked; localStorage.setItem(key, opts[id] ? '1' : '0'); log(`opção ${id}: ${opts[id]}`); };
}
// Hipótese 1: sem sessão "playback", o iOS deixa a mídia nova mudar de faixa em segundo plano, mas sem som.
function applyAudioSession() {
  if (!opts.optSession) return;
  if (!navigator.audioSession) return log('navigator.audioSession não existe neste iOS');
  if (navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
}

// ---------- reprodução ----------
// Hipótese 2: no intervalo entre "ended" e o próximo play() o iOS desativa o áudio do app.
// Com dois elementos, a próxima faixa começa ~1 s antes do fim da atual, sem intervalo.
const players = [audio, new Audio()];
players[1].playsInline = true;
players[1].preload = 'auto';
let cur = 0; // qual elemento de players está tocando
const urls = new Map(); // elemento -> blob URL atual
let index = -1;
let prefetch = null; // { index, promise }
let prepared = null; // { index, el }: próxima faixa já carregada no elemento parado
let advancing = false;
const active = () => players[cur];
const mb = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;

function setSrc(el, blob) {
  if (urls.has(el)) URL.revokeObjectURL(urls.get(el));
  const url = URL.createObjectURL(blob);
  urls.set(el, url);
  el.src = url;
}

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
  const promise = fetchBlob(i);
  prefetch = { index: i, promise };
  promise.then((blob) => {
    if (!opts.optTwo || prefetch?.index !== i || index !== i - 1) return;
    const el = players[1 - cur];
    setSrc(el, blob);
    el.load();
    prepared = { index: i, el };
    log(`faixa ${i + 1} preparada no 2º elemento`);
  }).catch((err) => { log(`erro no pré-carregamento: ${err.message}`); if (prefetch?.index === i) prefetch = null; });
}

async function playIndex(i, reason) {
  if (i < 0 || i >= tracks.length) { log('fim da fila'); return; }
  const t0 = performance.now();
  index = i;
  renderTracks();
  applyAudioSession();
  log(`faixa ${i + 1} (${reason}) · sessão=${navigator.audioSession?.type ?? 'n/d'} · 2 elementos=${opts.optTwo}`);
  try {
    const old = active();
    let el;
    if (prepared?.index === i) el = prepared.el;
    else {
      const blob = await (prefetch?.index === i ? prefetch.promise : fetchBlob(i));
      if (index !== i) return; // usuário pulou para outra faixa enquanto baixava
      el = opts.optTwo ? players[1 - cur] : old;
      setSrc(el, blob);
    }
    prepared = null;
    prefetch = null;
    el.addEventListener('playing', () => log(`tocando faixa ${i + 1}: ${((performance.now() - t0) / 1000).toFixed(1)} s desde o pedido`), { once: true });
    setMediaSession(tracks[i]);
    cur = players.indexOf(el); // antes do play(), para os eventos do novo elemento contarem como ativos
    await el.play();
    if (el !== old) old.pause(); // só pausa a anterior depois que a nova já está tocando
  } catch (err) { log(`erro ao tocar faixa ${i + 1}: ${err.message}`); }
  advancing = false;
}

for (const el of players) {
  const n = players.indexOf(el) + 1;
  el.addEventListener('playing', () => { if (el === active()) startPrefetch(index + 1); });
  el.addEventListener('ended', () => {
    if (el !== active() || advancing) return;
    log(`terminou faixa ${index + 1}`);
    playIndex(index + 1, 'fim da anterior');
  });
  el.addEventListener('pause', () => { if (el === active() && !el.ended) log('pausado'); });
  el.addEventListener('error', () => log(`erro do <audio> ${n}: ${el.error?.code}`));
  el.addEventListener('timeupdate', () => {
    if (el !== active() || !el.duration) return;
    if (opts.optTwo && !advancing && prepared?.index === index + 1 && el.duration - el.currentTime < 1) {
      advancing = true;
      log(`sobreposição: começando faixa ${index + 2} antes do fim`);
      playIndex(index + 1, 'fim (sobreposição)');
    }
    if (!('setPositionState' in navigator.mediaSession)) return;
    try { navigator.mediaSession.setPositionState({ duration: el.duration, position: el.currentTime, playbackRate: 1 }); } catch {}
  });
}

function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return log('Media Session não disponível');
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.name.replace(/\.[^.]+$/, ''), artist: 'Protótipo', album: t.path.split('/').slice(-2, -1)[0] || 'Músicas',
    artwork: [{ src: new URL('icon-180.png', location.href).href, sizes: '180x180', type: 'image/png' }],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => { log('tela de bloqueio: play'); applyAudioSession(); active().play(); });
  ms.setActionHandler('pause', () => { log('tela de bloqueio: pause'); active().pause(); });
  ms.setActionHandler('nexttrack', () => playIndex(index + 1, 'tela de bloqueio: próxima'));
  ms.setActionHandler('previoustrack', () => {
    if (active().currentTime > 3) { active().currentTime = 0; log('tela de bloqueio: voltou ao início'); }
    else playIndex(Math.max(0, index - 1), 'tela de bloqueio: anterior');
  });
  try { ms.setActionHandler('seekto', (d) => { active().currentTime = d.seekTime; }); } catch {}
}

$('playAll').onclick = () => playIndex(0, 'tocar tudo');

function refreshButtons() {
  const ok = !!getToken();
  $('list').disabled = !ok;
  $('playAll').disabled = !ok || !tracks.length;
}

// ---------- início ----------
$('mode').textContent += ` · protótipo ${VERSION}`;
if (!GOOGLE_CLIENT_ID) log('falta GOOGLE_CLIENT_ID em js/config.js');
handleRedirectReturn();
refreshButtons();
