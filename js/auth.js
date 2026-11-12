// Login Google (OAuth 2.0, fluxo implícito) por popup, que foi o fluxo validado no protótipo.
// Sem servidor não existe renovação 100% silenciosa: o token dura ~1 h e renovar exige um toque do usuário.
// O popup tenta primeiro sem tela (prompt=none) e só mostra a tela do Google se ela for necessária.
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');
const TOKEN_KEY = 'auth_token';
const STATE_KEY = 'auth_state';
const EXPIRY_MARGIN_MS = 60_000;
export const REDIRECT_URI = new URL('../', import.meta.url).href; // raiz do app, cadastrada no Google

export class AuthError extends Error {
  constructor(message = 'Entre com o Google para continuar.') { super(message); this.name = 'AuthError'; }
}

function readToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}

export function getToken() {
  const t = readToken();
  return t && t.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? t.value : null;
}

export function tokenMinutesLeft() {
  const t = readToken();
  return t ? Math.max(0, Math.round((t.expiresAt - Date.now()) / 60_000)) : 0;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function saveToken(value, expiresInSec) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ value, expiresAt: Date.now() + expiresInSec * 1000 }));
}

function authUrl(state, prompt) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    state,
  });
  if (prompt) params.set('prompt', prompt);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Precisa ser chamada direto num toque (click), senão o iOS bloqueia o popup.
export function signIn({ timeoutMs = 180_000 } = {}) {
  const nonce = crypto.randomUUID();
  localStorage.setItem(STATE_KEY, nonce);
  const popup = window.open(authUrl(`${nonce}.none`, 'none'), 'google-login', 'width=500,height=650');
  if (!popup) return Promise.reject(new AuthError('O navegador bloqueou a janela de login.'));

  return new Promise((resolve, reject) => {
    const done = (fn, arg) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      fn(arg);
    };
    const onMessage = (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'auth') return;
      if (e.data.error) done(reject, new AuthError(`Login não concluído (${e.data.error}).`));
      else { saveToken(e.data.token, e.data.expiresIn); done(resolve, e.data.token); }
    };
    // Se o popup perder o window.opener, ele grava o token no localStorage e este evento avisa.
    const onStorage = (e) => { if (e.key === TOKEN_KEY && getToken()) done(resolve, getToken()); };
    const timer = setTimeout(() => done(reject, new AuthError('O login demorou demais. Tente de novo.')), timeoutMs);
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
  });
}

// Chamar ao carregar a página do REDIRECT_URI. Retorna true se a página era o retorno do Google.
export function handleAuthReturn() {
  if (!/[#&](access_token|error)=/.test(location.hash)) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const [nonce, mode] = (p.get('state') || '').split('.');
  const opener = window.opener && !window.opener.closed ? window.opener : null;
  const reply = (msg) => { opener?.postMessage({ type: 'auth', ...msg }, location.origin); if (opener) window.close(); };

  if (!nonce || nonce !== localStorage.getItem(STATE_KEY)) { reply({ error: 'state_mismatch' }); return true; }

  const error = p.get('error');
  if (error && mode === 'none' && /interaction_required|consent_required|login_required|account_selection_required/.test(error)) {
    location.replace(authUrl(`${nonce}.consent`)); // mesma janela: agora mostra a tela do Google
    return true;
  }
  localStorage.removeItem(STATE_KEY);
  if (error) { reply({ error }); return true; }

  const token = p.get('access_token');
  const expiresIn = Number(p.get('expires_in') || 3600);
  saveToken(token, expiresIn);
  reply({ token, expiresIn });
  return true;
}
