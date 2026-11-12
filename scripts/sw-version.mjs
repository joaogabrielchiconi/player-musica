// Recalcula o VERSION do sw.js a partir do conteúdo dos arquivos do app (ASSETS).
// Rodar antes de publicar: node scripts/sw-version.mjs
// Uso como módulo (tests/sw.test.js): computeVersion() e readSw().
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const swPath = new URL('sw.js', root);

export function readSw() {
  const src = readFileSync(swPath, 'utf8');
  const version = src.match(/const VERSION = '([^']*)'/)[1];
  const assets = [...src.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { src, version, assets };
}

// './' é o index.html. \r é ignorado: o Git no Windows pode trocar LF por CRLF sem mudar o conteúdo.
export const fileOf = (asset) => new URL(asset === './' ? 'index.html' : asset, root);

export function computeVersion(assets = readSw().assets) {
  const h = createHash('sha256');
  for (const a of assets) {
    const buf = readFileSync(fileOf(a));
    h.update(a);
    h.update(a.endsWith('.png') ? buf : buf.toString('utf8').replace(/\r/g, ''));
  }
  return h.digest('hex').slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { src, version } = readSw();
  const next = computeVersion();
  if (next === version) console.log(`sw.js já está na versão ${version}`);
  else {
    writeFileSync(swPath, src.replace(`const VERSION = '${version}'`, `const VERSION = '${next}'`));
    console.log(`sw.js: ${version} -> ${next}`);
  }
}
