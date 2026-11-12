import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseId3, id3TagSize, titleFromFilename, fallbackTags, readTags } from '../js/tags.js';
import { AuthError } from '../js/auth.js';

// ---- montagem de tags ID3 de teste ----
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);
const utf16bom = (s) => { const a = [0xff, 0xfe]; for (const c of s) { const n = c.charCodeAt(0); a.push(n & 255, n >> 8); } return Uint8Array.from(a); };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const be32 = (n) => Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const ss32 = (n) => Uint8Array.of((n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127);

const text = (enc, s) => cat(Uint8Array.of(enc), enc === 3 ? utf8(s) : enc === 1 ? utf16bom(s) : latin1(s));
function frame(ver, id, data) {
  if (ver === 2) return cat(latin1(id), Uint8Array.of(data.length >> 16, (data.length >> 8) & 255, data.length & 255), data);
  return cat(latin1(id), ver === 4 ? ss32(data.length) : be32(data.length), Uint8Array.of(0, 0), data);
}
function tag(ver, frames, { padding = 16 } = {}) {
  const body = cat(...frames, new Uint8Array(padding));
  return cat(latin1('ID3'), Uint8Array.of(ver, 0, 0), ss32(body.length), body);
}
const apic = (type, img, mime = 'image/jpeg') => cat(Uint8Array.of(0), latin1(mime), Uint8Array.of(0, type), latin1('desc'), Uint8Array.of(0), img);

// ---- parseId3 ----
test('ID3v2.3 com latin1 e UTF-16, faixa "3/12" e capa', () => {
  const img = Uint8Array.of(0xff, 0xd8, 1, 2, 3);
  const b = tag(3, [
    frame(3, 'TIT2', text(1, 'Sinônimos')),
    frame(3, 'TPE1', text(0, 'Chitãozinho & Xororó')),
    frame(3, 'TALB', text(1, 'Acústico')),
    frame(3, 'TRCK', text(0, '3/12')),
    frame(3, 'APIC', apic(3, img)),
  ]);
  const t = parseId3(b);
  assert.equal(t.title, 'Sinônimos');
  assert.equal(t.artist, 'Chitãozinho & Xororó');
  assert.equal(t.album, 'Acústico');
  assert.equal(t.trackNo, 3);
  assert.equal(t.picture.mime, 'image/jpeg');
  assert.deepEqual([...t.picture.data], [...img]);
});

test('ID3v2.4 com UTF-8 e tamanhos syncsafe (frame > 127 bytes)', () => {
  const longTitle = 'Música '.repeat(30).trim();
  const t = parseId3(tag(4, [frame(4, 'TIT2', text(3, longTitle)), frame(4, 'TPE1', text(3, 'José'))]));
  assert.equal(t.title, longTitle);
  assert.equal(t.artist, 'José');
});

test('ID3v2.2 com frames de 3 letras e PIC', () => {
  const pic = cat(Uint8Array.of(0), latin1('PNG'), Uint8Array.of(3), latin1('x'), Uint8Array.of(0), Uint8Array.of(0x89, 0x50));
  const t = parseId3(tag(2, [frame(2, 'TT2', text(0, 'Antiga')), frame(2, 'TP1', text(0, 'Banda')), frame(2, 'PIC', pic)]));
  assert.equal(t.title, 'Antiga');
  assert.equal(t.artist, 'Banda');
  assert.equal(t.picture.mime, 'image/png');
  assert.deepEqual([...t.picture.data], [0x89, 0x50]);
});

test('prefere a capa frontal (tipo 3) e usa artista do álbum se faltar artista', () => {
  const t = parseId3(tag(3, [
    frame(3, 'TPE2', text(0, 'Vários')),
    frame(3, 'APIC', apic(0, Uint8Array.of(1))),
    frame(3, 'APIC', apic(3, Uint8Array.of(2), 'jpg')),
  ]));
  assert.equal(t.artist, 'Vários');
  assert.deepEqual([...t.picture.data], [2]);
  assert.equal(t.picture.mime, 'image/jpeg');
});

test('sem tag ID3 retorna null; tamanho da tag inclui cabeçalho e rodapé', () => {
  assert.equal(parseId3(Uint8Array.of(0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0)), null);
  assert.equal(id3TagSize(Uint8Array.of(1, 2, 3)), 0);
  const b = tag(3, [frame(3, 'TIT2', text(0, 'x'))]);
  assert.equal(id3TagSize(b), b.length);
  const v4footer = Uint8Array.from(tag(4, []));
  v4footer[5] = 0x10;
  assert.equal(id3TagSize(v4footer), v4footer.length + 10);
});

test('tag cortada no meio não quebra', () => {
  const b = tag(3, [frame(3, 'TIT2', text(0, 'Inteiro')), frame(3, 'APIC', apic(3, new Uint8Array(1000)))]);
  const t = parseId3(b.subarray(0, 40));
  assert.equal(t.title, 'Inteiro');
});

// ---- nome do arquivo ----
test('nome do arquivo: "Artista - Título" e sem separador', () => {
  assert.deepEqual(titleFromFilename('Chitãozinho & Xororó - Sinônimos (Acústico).mp3'), { artist: 'Chitãozinho & Xororó', title: 'Sinônimos (Acústico)' });
  assert.deepEqual(titleFromFilename('MC Pedrinho   Piriquita Voa.mp3'), { artist: null, title: 'MC Pedrinho   Piriquita Voa' });
  assert.deepEqual(fallbackTags({ name: 'Faixa.mp3', folder: 'Rock/Álbum X' }), { title: 'Faixa', artist: 'Desconhecido', album: 'Álbum X', trackNo: undefined });
  assert.equal(fallbackTags({ name: 'Faixa.mp3', folder: '' }).album, 'Sem álbum');
});

// ---- readTags com Drive falso ----
function fakeDrive(fileBytes, { fail } = {}) {
  const calls = [];
  return {
    calls,
    downloadRange: async (id, start, end) => {
      calls.push([start, end]);
      if (fail) throw fail;
      return fileBytes.slice(start, end + 1).buffer;
    },
  };
}

test('capa maior que 512 KB: busca de novo até o fim da tag', async () => {
  const big = new Uint8Array(700 * 1024).fill(7);
  const file = cat(tag(3, [frame(3, 'TIT2', text(0, 'Grande')), frame(3, 'APIC', apic(3, big))]), new Uint8Array(100));
  const drive = fakeDrive(file);
  const t = await readTags({ id: 'x', name: 'x.mp3', size: file.length, folder: '' }, drive);
  assert.equal(drive.calls.length, 2);
  assert.equal(t.title, 'Grande');
  assert.equal(t.art.size, big.length);
  assert.equal(t.art.type, 'image/jpeg');
});

test('sem tag ou com erro de rede: usa o nome do arquivo; AuthError sobe', async () => {
  const file = { id: 'x', name: 'Banda - Música.mp3', size: 2000, folder: 'Álbum' };
  const semTag = await readTags(file, fakeDrive(new Uint8Array(2000)));
  assert.deepEqual(semTag, { title: 'Música', artist: 'Banda', album: 'Álbum', trackNo: undefined, art: null });

  const rede = await readTags(file, fakeDrive(null, { fail: new Error('offline') }));
  assert.equal(rede.title, 'Música');

  await assert.rejects(readTags(file, fakeDrive(null, { fail: new AuthError() })), AuthError);
});
