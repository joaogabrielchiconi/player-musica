import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { readSw, computeVersion, fileOf } from '../scripts/sw-version.mjs';

test('sw.js: VERSION bate com o conteúdo dos arquivos (rode node scripts/sw-version.mjs)', () => {
  assert.equal(readSw().version, computeVersion());
});

test('sw.js: todo arquivo listado existe, e todo módulo importado pelo app está na lista', () => {
  const { assets } = readSw();
  for (const a of assets) assert.ok(existsSync(fileOf(a)), `falta ${a}`);
  const js = assets.filter((a) => a.endsWith('.js'));
  for (const a of js) {
    const src = readFileSync(fileOf(a), 'utf8');
    for (const [, imp] of src.matchAll(/from '\.\/([^']+)'/g)) {
      assert.ok(assets.includes(`js/${imp}`), `${a} importa js/${imp}, que não está no sw.js`);
    }
  }
  const html = readFileSync(fileOf('./'), 'utf8');
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)) {
    assert.ok(assets.includes(ref), `index.html usa ${ref}, que não está no sw.js`);
  }
});
