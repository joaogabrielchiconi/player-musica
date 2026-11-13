// Service worker: guarda os arquivos do app para ele abrir sem internet.
// Áudio, capas e chamadas ao Google nunca passam por aqui (só os arquivos listados em ASSETS).
//
// Atualização: o VERSION muda a cada publicação (node scripts/sw-version.mjs; o teste tests/sw.test.js
// falha se ele estiver velho). O navegador vê o sw.js diferente, baixa TODOS os arquivos para um cache
// novo e só então troca (tudo ou nada: nunca mistura arquivos de versões diferentes).
// A troca vale a partir da abertura seguinte do app.
const VERSION = '1dd9042937c2';
const CACHE = `app-${VERSION}`;
const ASSETS = [
  './',
  'css/app.css',
  'js/app.js',
  'js/auth.js',
  'js/config.js',
  'js/db.js',
  'js/dialogs.js',
  'js/drive.js',
  'js/library.js',
  'js/offline.js',
  'js/player.js',
  'js/playlists.js',
  'js/queue.js',
  'js/tags.js',
  'js/ui.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
// No PC (localhost) a rede vem primeiro, para o desenvolvimento não ficar preso em arquivo velho.
const DEV = self.location.hostname === 'localhost';

const urlOf = (a) => new URL(a, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(urlOf(a), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google: direto para a rede
  const path = url.origin + url.pathname;
  const scope = self.registration.scope;
  // A página do app (com ?… ou #… do login) é sempre a mesma: './'. Outras páginas (proto/, debug/) vão para a rede.
  let key = null;
  if (req.mode === 'navigate') {
    if (path === scope || path === urlOf('index.html')) key = urlOf('./');
  } else if (ASSETS.some((a) => urlOf(a) === path)) {
    key = path;
  }
  if (!key) return;

  const fromCache = () => caches.open(CACHE).then((c) => c.match(key));
  if (DEV) {
    e.respondWith(fetch(req).catch(() => fromCache().then((r) => r || Response.error())));
    return;
  }
  e.respondWith(fromCache().then((r) => r || fetch(req)));
});
