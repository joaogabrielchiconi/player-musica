import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOffline } from '../js/offline.js';
import { AuthError } from '../js/auth.js';
import { DriveError } from '../js/drive.js';

function memDb() {
  const audio = new Map();
  return {
    audio,
    get: async (s, k) => audio.get(k),
    put: async (s, k, v) => { audio.set(k, v); },
    del: async (s, k) => { audio.delete(k); },
    keys: async () => [...audio.keys()],
  };
}
// Resposta em pedaços; cut = para no meio com erro de rede (internet caiu).
function response(bytes, { cut = false } = {}) {
  const body = new ReadableStream({
    start(c) {
      const half = Math.floor(bytes.length / 2);
      c.enqueue(bytes.slice(0, half));
      if (cut) c.error(new TypeError('Load failed'));
      else { c.enqueue(bytes.slice(half)); c.close(); }
    },
  });
  return new Response(body, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) } });
}
const track = (id, size = 10) => ({ id, size });
const flush = () => new Promise((r) => setTimeout(r, 20));

function setup(behavior = {}) {
  const db = memDb();
  const calls = [];
  const drive = {
    request: async (path) => {
      const id = decodeURIComponent(path.split('/')[1]);
      calls.push(id);
      const b = behavior[id];
      if (b instanceof Error) throw b;
      if (typeof b === 'function') return b();
      return response(new Uint8Array(10).fill(1));
    },
  };
  const events = [];
  const off = createOffline({ db, drive, onChange: (e) => events.push(e) });
  return { db, off, calls, events };
}

test('baixa um por vez, grava inteiro e marca como baixada', async () => {
  const { db, off, calls } = setup();
  await off.init();
  assert.equal(off.enqueue([track('a'), track('b'), track('a')]), 2);
  assert.equal(off.state('b'), 'queued');
  await flush();
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(off.state('a'), 'done');
  assert.equal((await db.get('audio', 'b')).size, 10);
  assert.equal(off.count, 2);
  assert.equal(off.enqueue([track('a')]), 0); // já baixada
});

test('internet cai no meio: nada gravado, faixa continua na fila e termina no resume', async () => {
  let cut = true;
  const { db, off } = setup({ a: () => response(new Uint8Array(10), { cut }) });
  off.enqueue([track('a'), track('b')]);
  await flush();
  assert.equal(await db.get('audio', 'a'), undefined);
  assert.equal(off.state('a'), 'queued');
  assert.ok(off.status.error instanceof TypeError);
  cut = false;
  off.resume();
  await flush();
  assert.equal(off.state('a'), 'done');
  assert.equal(off.state('b'), 'done');
});

test('tamanho diferente do Drive não conta como baixada; erro do Drive pula e segue', async () => {
  const { db, off } = setup({ a: () => response(new Uint8Array(4)), b: new DriveError(404, '') });
  off.enqueue([track('a'), track('b'), track('c')]);
  await flush();
  assert.equal(await db.get('audio', 'a'), undefined);
  assert.equal(off.state('a'), null);
  assert.equal(off.state('b'), null);
  assert.equal(off.state('c'), 'done');
  assert.equal(off.status.failed, 2);
});

test('login vencido para a fila sem perder nada', async () => {
  const { off } = setup({ a: new AuthError() });
  off.enqueue([track('a'), track('b')]);
  await flush();
  assert.ok(off.status.error instanceof AuthError);
  assert.equal(off.status.queued, 2);
});

test('apagar tira do banco e da fila', async () => {
  const { db, off } = setup();
  off.enqueue([track('a')]);
  await flush();
  await off.remove(['a']);
  assert.equal(off.has('a'), false);
  assert.equal(await db.get('audio', 'a'), undefined);
  await off.init();
  assert.equal(off.count, 0);
});
