// Telas da biblioteca (T6): abas Músicas, Artistas e Álbuns, busca e detalhe de artista/álbum.
// Visual provisório: o design definitivo sai da T13.
import { groupByAlbum, groupByArtist, searchTracks, sortTracks } from './library.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

/**
 * @param {object} o
 * @param {HTMLElement} o.root     onde as listas são desenhadas
 * @param {HTMLElement} o.title    título da tela atual
 * @param {HTMLElement} o.back     botão voltar
 * @param {HTMLInputElement} o.search
 * @param {NodeListOf<HTMLButtonElement>} o.tabs  botões com data-tab
 * @param {(store: string, key: string) => Promise<any>} o.getArt
 * @param {(track: object, list: object[]) => void} o.onPlay
 */
export function createLibraryUI({ root, title, back, search, tabs, getArt, onPlay }) {
  let tracks = [];
  let tab = 'songs';
  let detail = null; // { kind: 'artist' | 'album', group }
  const artUrls = new Map(); // albumKey -> object URL (fica enquanto o app está aberto)

  async function artUrl(key) {
    if (!artUrls.has(key)) {
      const blob = await getArt('art', key);
      artUrls.set(key, blob ? URL.createObjectURL(blob) : null);
    }
    return artUrls.get(key);
  }

  function trackList(list, { showAlbum = true, numbered = false } = {}) {
    const ul = el('ul', { className: 'tracks' });
    const frag = document.createDocumentFragment();
    for (const t of list) {
      const sub = showAlbum ? `${t.artist} · ${t.album}` : t.artist;
      const li = el('li', { className: 'row', tabIndex: 0 },
        el('span', { className: 'title', textContent: numbered && t.trackNo ? `${t.trackNo}. ${t.title}` : t.title }),
        el('span', { className: 'sub', textContent: sub }));
      if (t.removedFromDrive) li.append(el('span', { className: 'sub removed', textContent: 'removida do Drive' }));
      li.onclick = () => onPlay(t, list);
      frag.append(li);
    }
    ul.append(frag);
    return ul;
  }

  function groupList(groups, label, open) {
    const ul = el('ul', { className: 'tracks' });
    const frag = document.createDocumentFragment();
    for (const g of groups) {
      const li = el('li', { className: 'row', tabIndex: 0 },
        el('span', { className: 'title', textContent: label(g).title }),
        el('span', { className: 'sub', textContent: label(g).sub }));
      li.onclick = () => open(g);
      frag.append(li);
    }
    ul.append(frag);
    return ul;
  }

  const count = (n) => `${n} música${n === 1 ? '' : 's'}`;

  function openDetail(kind, group) {
    // O álbum aberto a partir de um artista lembra de onde veio, para o "voltar".
    detail = { kind, group, from: detail?.kind === 'artist' ? detail : null };
    window.scrollTo(0, 0);
    render();
  }

  async function renderAlbum(g) {
    const cover = el('div', { className: 'cover' });
    const head = el('div', { className: 'album-head' }, cover,
      el('div', {}, el('p', { className: 'title', textContent: g.artist }), el('p', { className: 'sub', textContent: count(g.tracks.length) })));
    root.append(head, trackList(g.tracks, { showAlbum: false, numbered: true }));
    const url = g.hasArt ? await artUrl(g.key) : null;
    if (url) cover.append(el('img', { src: url, alt: `Capa de ${g.album}` }));
  }

  function render() {
    root.textContent = '';
    const q = search.value;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    back.hidden = !detail;
    search.hidden = Boolean(detail);

    if (detail?.kind === 'album') {
      title.textContent = detail.group.album;
      return renderAlbum(detail.group);
    }
    if (detail?.kind === 'artist') {
      title.textContent = detail.group.artist;
      return root.append(groupList(detail.group.albums,
        (a) => ({ title: a.album, sub: count(a.tracks.length) }), (a) => openDetail('album', a)));
    }

    const found = searchTracks(tracks, q);
    if (!tracks.length) return; // a mensagem de "entre/atualize" fica no status
    if (!found.length) return root.append(el('p', { className: 'status', textContent: `Nada encontrado para "${q}".` }));

    if (tab === 'songs') {
      title.textContent = 'Músicas';
      root.append(trackList(sortTracks(found)));
    } else if (tab === 'artists') {
      title.textContent = 'Artistas';
      root.append(groupList(groupByArtist(found),
        (g) => ({ title: g.artist, sub: `${g.albums.length} álbum(ns) · ${count(g.tracks.length)}` }), (g) => openDetail('artist', g)));
    } else {
      title.textContent = 'Álbuns';
      root.append(groupList(groupByAlbum(found),
        (g) => ({ title: g.album, sub: `${g.artist} · ${count(g.tracks.length)}` }), (g) => openDetail('album', g)));
    }
  }

  for (const b of tabs) b.onclick = () => { tab = b.dataset.tab; detail = null; render(); };
  back.onclick = () => { detail = detail?.from ?? null; render(); };
  search.oninput = render;

  return {
    setTracks(list) {
      tracks = list;
      // Depois de sincronizar, um detalhe aberto pode ter mudado: volta para a aba.
      detail = null;
      render();
    },
  };
}
