// Leitor próprio de tags ID3v2 (2.2, 2.3, 2.4): título, artista, álbum, faixa e capa.
// Sem tag (ou M4A), os dados vêm do nome do arquivo e da subpasta.

const PROBE_BYTES = 512 * 1024;
const MAX_TAG_BYTES = 20 * 1024 * 1024; // proteção contra cabeçalho corrompido

const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const uint32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const uint24 = (b, i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

const hasId3 = (b) => b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b[3] >= 2 && b[3] <= 4;

// Quantos bytes do início do arquivo a tag ocupa (0 se não houver tag ID3v2).
export function id3TagSize(bytes) {
  if (!hasId3(bytes)) return 0;
  const footer = bytes[3] === 4 && bytes[5] & 0x10 ? 10 : 0;
  return 10 + syncsafe(bytes, 6) + footer;
}

// Desfaz a "unsynchronisation" do ID3: todo 0xFF 0x00 vira 0xFF.
function unsync(b) {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

function decodeText(enc, b) {
  if (enc === 1) {
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    return new TextDecoder('utf-16le').decode(b);
  }
  if (enc === 2) return new TextDecoder('utf-16be').decode(b);
  if (enc === 3) return new TextDecoder('utf-8').decode(b);
  return new TextDecoder('latin1').decode(b);
}

// Fim do texto terminado em zero: 1 byte zero (latin1/utf-8) ou 2 bytes zero alinhados (utf-16).
function textEnd(enc, b, start) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return [i, i + 2];
  } else {
    const i = b.indexOf(0, start);
    if (i >= 0) return [i, i + 1];
  }
  return [b.length, b.length];
}

// v2.4 permite vários valores separados por zero: fica o primeiro.
const textFrame = (d) => decodeText(d[0], d.subarray(1)).split('\0')[0].trim();

function pictureFrame(d, v2) {
  const enc = d[0];
  let i = 1;
  let mime;
  if (v2) { // ID3v2.2 "PIC": formato de 3 letras (JPG, PNG)
    mime = ascii(d, 1, 3).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    const end = d.indexOf(0, 1);
    if (end < 0) return null;
    mime = ascii(d, 1, end - 1).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = `image/${mime}`;
    if (mime === 'image/jpg') mime = 'image/jpeg';
    i = end + 1;
  }
  const type = d[i];
  const [, dataStart] = textEnd(enc, d, i + 1); // pula a descrição
  return { mime, type, data: d.subarray(dataStart) };
}

const IDS = {
  2: { title: 'TT2', artist: 'TP1', albumArtist: 'TP2', album: 'TAL', track: 'TRK', pic: 'PIC' },
  3: { title: 'TIT2', artist: 'TPE1', albumArtist: 'TPE2', album: 'TALB', track: 'TRCK', pic: 'APIC' },
};
IDS[4] = IDS[3];

// Retorna { title, artist, album, trackNo, picture } com os campos encontrados, ou null sem tag.
export function parseId3(bytes) {
  if (!hasId3(bytes)) return null;
  const ver = bytes[3];
  const flags = bytes[5];
  const end = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  let body = bytes.subarray(10, end);
  if (ver < 4 && flags & 0x80) body = unsync(body);
  let p = 0;
  if (ver >= 3 && flags & 0x40) p = ver === 3 ? 4 + uint32(body, 0) : syncsafe(body, 0); // cabeçalho estendido

  const ids = IDS[ver];
  const headLen = ver === 2 ? 6 : 10;
  const found = {};
  const pictures = [];
  while (p + headLen <= body.length && body[p] !== 0) {
    const id = ascii(body, p, ver === 2 ? 3 : 4);
    const size = ver === 2 ? uint24(body, p + 3) : ver === 4 ? syncsafe(body, p + 4) : uint32(body, p + 4);
    const fmt = ver === 2 ? 0 : body[p + 9];
    let data = body.subarray(p + headLen, p + headLen + size);
    p += headLen + size;
    if (size <= 0 || !/^[A-Z0-9]+$/.test(id)) break;
    if (ver === 4) {
      if (fmt & 0x02) data = unsync(data);
      if (fmt & 0x01) data = data.subarray(4); // indicador de tamanho
    }
    if (ver >= 3 && fmt & 0x0c) continue; // frame comprimido ou criptografado: ignora
    if (id === ids.pic) { const pic = pictureFrame(data, ver === 2); if (pic) pictures.push(pic); }
    else if (id === ids.title) found.title = textFrame(data);
    else if (id === ids.artist) found.artist = textFrame(data);
    else if (id === ids.albumArtist) found.albumArtist = textFrame(data);
    else if (id === ids.album) found.album = textFrame(data);
    else if (id === ids.track) found.trackNo = parseInt(textFrame(data), 10) || undefined;
  }
  const picture = pictures.find((x) => x.type === 3) ?? pictures[0];
  return {
    title: found.title || undefined,
    artist: found.artist || found.albumArtist || undefined,
    album: found.album || undefined,
    trackNo: found.trackNo,
    picture: picture?.data.length ? { mime: picture.mime, data: picture.data } : undefined,
  };
}

// "Artista - Título.mp3" vira { artist, title }; sem " - ", tudo é o título.
export function titleFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: null, title: base };
}

export function fallbackTags(file) {
  const { artist, title } = titleFromFilename(file.name);
  const album = file.folder ? file.folder.split('/').pop() : '';
  return { title, artist: artist || 'Desconhecido', album: album || 'Sem álbum', trackNo: undefined };
}

// Lê as tags de um arquivo do Drive. Retorna { title, artist, album, trackNo, art: Blob|null }.
// Falha de rede ou tag ilegível cai no nome do arquivo; só AuthError sobe (precisa de "Entrar").
export async function readTags(file, drive) {
  const fb = fallbackTags(file);
  let tag = null;
  try {
    const first = Math.min(PROBE_BYTES, file.size || PROBE_BYTES);
    let bytes = new Uint8Array(await drive.downloadRange(file.id, 0, first - 1));
    const need = id3TagSize(bytes);
    if (need > bytes.length && need <= MAX_TAG_BYTES) bytes = new Uint8Array(await drive.downloadRange(file.id, 0, need - 1));
    tag = parseId3(bytes);
  } catch (err) {
    if (err.name === 'AuthError') throw err;
  }
  return {
    title: tag?.title || fb.title,
    artist: tag?.artist || fb.artist,
    album: tag?.album || fb.album,
    trackNo: tag?.trackNo ?? fb.trackNo,
    art: tag?.picture ? new Blob([tag.picture.data], { type: tag.picture.mime }) : null,
  };
}
