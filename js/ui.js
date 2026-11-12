// Telas da biblioteca: abas Músicas, Artistas, Álbuns, Playlists e Baixadas, busca, detalhes, downloads e playlists (T6, T10, T11).
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
 * @param {HTMLInputElement} o.onlyDownloaded  filtro "Só baixadas"
 * @param {(track: object) => boolean} o.isDownloaded
 * @param {(track: object) => boolean} o.isAvailable  toca agora (com internet, ou baixada)
 * @param {object} o.downloads  state(id), percent(id), add(list), toggle(t), removeAll(list), progressText(), spaceText()
 * @param {object} o.playlists  list(), get(id), tracksOf(pl), create(name), rename(id, name), remove(id), add(id, ids), removeAt(id, i), move(id, from, to)
 * @param {(text: string) => void} o.toast
 */
export function createLibraryUI({ root, title, back, search, tabs, getArt, onPlay, onlyDownloaded, isDownloaded, isAvailable, downloads, playlists, toast }) {
  let tracks = [];
  let tab = 'songs';
  let detail = null; // { kind: 'artist' | 'album' | 'playlist', group } (playlist: group = { id })
  let editing = false; // detalhe de playlist em modo de edição (▲ ▼ ✕)
  const artUrls = new Map(); // albumKey -> object URL (fica enquanto o app está aberto)
  let dlButtons = new Map(); // id -> [{ t, b }] dos botões de download na tela, para atualizar o %
  let progressEl = null; // linha de progresso da aba Baixadas, quando aberta

  function setDl(b, t) {
    const s = downloads.state(t.id);
    const [text, label] = s === 'done' ? ['✓', `Baixada. Toque para apagar o download de ${t.title}`]
      : s === 'active' ? [`${downloads.percent(t.id)}%`, `Baixando ${t.title}`]
        : s === 'queued' ? ['…', `${t.title} na fila para baixar. Toque para tirar da fila`]
          : ['⬇︎', `Baixar ${t.title}`];
    b.textContent = text;
    b.ariaLabel = label;
    b.classList.toggle('done', s === 'done');
  }

  // Baixar todas / baixando / apagar downloads de um álbum ou artista.
  function bulkButton(list, what = 'todas') {
    const states = list.map((t) => downloads.state(t.id));
    const missing = states.filter((s) => !s).length;
    if (missing) {
      const text = missing === list.length ? `Baixar ${what} (${missing})` : `Baixar as ${missing} que faltam`;
      return el('button', { className: 'bulk', textContent: text, onclick: () => downloads.add(list) });
    }
    if (states.some((s) => s !== 'done')) return el('button', { className: 'bulk', textContent: 'Baixando…', disabled: true });
    return el('button', { className: 'bulk', textContent: 'Apagar downloads', onclick: () => downloads.removeAll(list) });
  }

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
      if (!isAvailable(t)) { li.classList.add('off'); li.ariaDisabled = 'true'; } // sem internet e não baixada
      li.onclick = () => onPlay(t, list);
      const add = el('button', {
        className: 'add', type: 'button', textContent: '+', ariaLabel: `Adicionar ${t.title} a uma playlist`,
        onclick: (e) => { e.stopPropagation(); pickPlaylist([t.id]); },
      });
      const b = el('button', { className: 'dl', type: 'button' });
      setDl(b, t);
      b.onclick = (e) => { e.stopPropagation(); downloads.toggle(t); };
      li.append(add, b);
      if (!dlButtons.has(t.id)) dlButtons.set(t.id, []);
      dlButtons.get(t.id).push({ t, b });
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

  // ---- playlists (T11) ----
  const askName = (initial = '') => prompt('Nome da playlist:', initial); // provisório: o design final troca por uma tela própria

  // Folha de baixo: escolhe a playlist (ou cria uma) para receber as faixas.
  function pickPlaylist(ids) {
    const close = () => overlay.remove();
    const done = async (id) => {
      const n = await playlists.add(id, ids);
      close();
      toast(n ? `${n} música(s) em "${playlists.get(id).name}".` : `Já estava em "${playlists.get(id).name}".`);
    };
    const list = el('ul', { className: 'sheet-list' });
    for (const pl of playlists.list()) {
      list.append(el('li', {}, el('button', { textContent: `${pl.name} · ${count(pl.trackIds.length)}`, onclick: () => done(pl.id) })));
    }
    const create = el('button', {
      textContent: '+ Nova playlist',
      onclick: async () => {
        const name = askName();
        if (!name) return;
        const pl = await playlists.create(name);
        if (pl) await done(pl.id); else toast('Nome inválido.');
      },
    });
    const overlay = el('div', { className: 'sheet', onclick: (e) => { if (e.target === overlay) close(); } },
      el('div', { className: 'sheet-body', role: 'dialog', ariaLabel: 'Adicionar à playlist' },
        el('h2', { textContent: `Adicionar ${count(ids.length)} a…` }), list, create,
        el('button', { textContent: 'Cancelar', onclick: close })));
    document.body.append(overlay);
  }
  const addAllButton = (list) => el('button', { className: 'bulk', textContent: '+ Adicionar à playlist', onclick: () => pickPlaylist(list.map((t) => t.id)) });

  function renderPlaylistList() {
    const all = playlists.list();
    root.append(el('button', {
      className: 'bulk', textContent: '+ Nova playlist',
      onclick: async () => {
        const name = askName();
        if (!name) return;
        const pl = await playlists.create(name);
        if (pl) openDetail('playlist', { id: pl.id }); else toast('Nome inválido.');
      },
    }));
    if (!all.length) return root.append(el('p', { className: 'status', textContent: 'Nenhuma playlist ainda.' }));
    root.append(groupList(all, (pl) => ({ title: pl.name, sub: count(playlists.tracksOf(pl).length) }), (pl) => openDetail('playlist', { id: pl.id })));
  }

  // Modo de edição: ▲ ▼ mexem na ordem (em relação à faixa vizinha da lista) e ✕ tira da playlist.
  function editRows(pl, list) {
    const ul = el('ul', { className: 'tracks' });
    const ctl = (text, label, onclick, disabled = false) => el('button', { className: 'ctl', type: 'button', textContent: text, ariaLabel: label, disabled, onclick });
    list.forEach((t, i) => {
      const idx = pl.trackIds.indexOf(t.id);
      ul.append(el('li', { className: 'row edit' },
        el('span', { className: 'title', textContent: t.title }),
        el('span', { className: 'sub', textContent: t.artist }),
        el('span', { className: 'ctls' },
          ctl('▲', `Subir ${t.title}`, () => playlists.move(pl.id, idx, pl.trackIds.indexOf(list[i - 1].id)), i === 0),
          ctl('▼', `Descer ${t.title}`, () => playlists.move(pl.id, idx, pl.trackIds.indexOf(list[i + 1].id)), i === list.length - 1),
          ctl('✕', `Tirar ${t.title} da playlist`, () => playlists.removeAt(pl.id, idx)))));
    });
    return ul;
  }

  function renderPlaylist(id) {
    const pl = playlists.get(id);
    if (!pl) { detail = null; return render(); } // foi apagada
    title.textContent = pl.name;
    const list = playlists.tracksOf(pl);
    const hidden = pl.trackIds.length - list.length;
    root.append(
      el('p', { className: 'sub', textContent: `${count(list.length)}${hidden ? ` · ${hidden} fora da biblioteca` : ''}` }),
      el('div', { className: 'actions' },
        el('button', { textContent: '▶︎ Tocar', disabled: !list.some(isAvailable), onclick: () => onPlay(list.find(isAvailable), list) }),
        el('button', { textContent: editing ? 'Pronto' : 'Editar', onclick: () => { editing = !editing; render(); } })),
    );
    if (list.length) root.append(bulkButton(list, 'playlist'));
    else root.append(el('p', { className: 'status', textContent: 'Playlist vazia. Toque em + numa música, ou em "Adicionar à playlist" num álbum.' }));
    root.append(editing ? editRows(pl, list) : trackList(list));
    if (editing) {
      root.append(el('div', { className: 'actions' },
        el('button', { textContent: 'Renomear', onclick: () => { const name = askName(pl.name); if (name) playlists.rename(pl.id, name); } }),
        el('button', {
          className: 'danger', textContent: 'Apagar playlist',
          onclick: () => {
            if (!confirm(`Apagar a playlist "${pl.name}"? As músicas e os downloads não são apagados.`)) return;
            editing = false;
            detail = null;
            playlists.remove(pl.id);
          },
        })));
    }
  }

  function openDetail(kind, group) {
    // O álbum aberto a partir de um artista lembra de onde veio, para o "voltar".
    detail = { kind, group, from: detail?.kind === 'artist' ? detail : null };
    editing = false;
    window.scrollTo(0, 0);
    render();
  }

  async function renderAlbum(g) {
    const cover = el('div', { className: 'cover' });
    const head = el('div', { className: 'album-head' }, cover,
      el('div', {}, el('p', { className: 'title', textContent: g.artist }), el('p', { className: 'sub', textContent: count(g.tracks.length) }),
        bulkButton(g.tracks), addAllButton(g.tracks)));
    root.append(head, trackList(g.tracks, { showAlbum: false, numbered: true }));
    const url = g.hasArt ? await artUrl(g.key) : null;
    if (url) cover.append(el('img', { src: url, alt: `Capa de ${g.album}` }));
  }

  function render() {
    root.textContent = '';
    dlButtons = new Map();
    progressEl = null;
    const q = search.value;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    back.hidden = !detail;
    search.hidden = Boolean(detail) || tab === 'playlists';

    if (detail?.kind === 'playlist') return renderPlaylist(detail.group.id);
    if (detail?.kind === 'album') {
      title.textContent = detail.group.album;
      return renderAlbum(detail.group);
    }
    if (detail?.kind === 'artist') {
      title.textContent = detail.group.artist;
      return root.append(bulkButton(detail.group.tracks), addAllButton(detail.group.tracks), groupList(detail.group.albums,
        (a) => ({ title: a.album, sub: count(a.tracks.length) }), (a) => openDetail('album', a)));
    }
    if (tab === 'playlists') {
      title.textContent = 'Playlists';
      return renderPlaylistList();
    }

    const pool = onlyDownloaded.checked ? tracks.filter(isDownloaded) : tracks;
    const found = searchTracks(pool, q);
    if (!tracks.length) return; // a mensagem de "entre/atualize" fica no status
    if (!pool.length) return root.append(el('p', { className: 'status', textContent: 'Nenhuma música baixada ainda.' }));
    if (!found.length) return root.append(el('p', { className: 'status', textContent: `Nada encontrado para "${q}".` }));

    if (tab === 'songs') {
      title.textContent = 'Músicas';
      root.append(trackList(sortTracks(found)));
    } else if (tab === 'artists') {
      title.textContent = 'Artistas';
      root.append(groupList(groupByArtist(found),
        (g) => ({ title: g.artist, sub: `${g.albums.length} álbum(ns) · ${count(g.tracks.length)}` }), (g) => openDetail('artist', g)));
    } else if (tab === 'albums') {
      title.textContent = 'Álbuns';
      root.append(groupList(groupByAlbum(found),
        (g) => ({ title: g.album, sub: `${g.artist} · ${count(g.tracks.length)}` }), (g) => openDetail('album', g)));
    } else {
      title.textContent = 'Baixadas';
      const space = el('p', { className: 'status', textContent: 'Calculando o espaço…' });
      downloads.spaceText().then((text) => { space.textContent = text; }).catch(() => { space.textContent = ''; });
      progressEl = el('p', { className: 'status', textContent: downloads.progressText() });
      root.append(el('div', { className: 'panel' }, space, progressEl));
      const mine = sortTracks(found.filter(isDownloaded));
      if (!mine.length) {
        return root.append(el('p', { className: 'status', textContent: 'Nenhuma música baixada ainda. Toque em ⬇︎ numa música ou em "Baixar todas" num álbum.' }));
      }
      root.append(trackList(mine));
    }
  }

  for (const b of tabs) b.onclick = () => { tab = b.dataset.tab; detail = null; editing = false; render(); };
  back.onclick = () => { detail = detail?.from ?? null; editing = false; render(); };
  search.oninput = render;
  onlyDownloaded.onchange = () => { detail = null; editing = false; render(); };

  return {
    refresh: render, // a internet caiu ou voltou, ou um download mudou: redesenha sem sair da tela atual
    // Só o % de uma faixa mudou: atualiza o botão dela e a linha de progresso, sem redesenhar a lista.
    updateDownload(id) {
      for (const { t, b } of dlButtons.get(id) ?? []) setDl(b, t);
      if (progressEl) progressEl.textContent = downloads.progressText();
    },
    setTracks(list) {
      tracks = list;
      // Depois de sincronizar, um detalhe aberto pode ter mudado: volta para a aba.
      detail = null;
      editing = false;
      render();
    },
  };
}

// ---- mini player e tela cheia (T7) ----
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const REPEAT_LABEL = { off: 'Repetir: desligado', all: 'Repetir: tudo', one: 'Repetir: uma' };

/**
 * @param {object} o
 * @param {ReturnType<import('./player.js').createPlayer>} o.player
 * @param {(track: object) => Promise<string|null>} o.artUrl
 * @param {(id: string) => HTMLElement} o.$
 * @param {(track: object) => boolean} o.canPlay  false: não toca (e quem chamou já avisou)
 */
export function createPlayerUI({ player, artUrl, $, canPlay }) {
  let shownId = null; // faixa desenhada na capa/títulos
  let shownOrder = null; // fila desenhada na lista (order e items de q)
  let shownItems = null;
  let dragging = false;

  $('miniOpen').onclick = () => { $('full').hidden = false; document.body.classList.add('full-open'); scrollQueue(); };
  $('fullClose').onclick = () => { $('full').hidden = true; document.body.classList.remove('full-open'); };
  $('miniToggle').onclick = $('toggle').onclick = () => player.toggle();
  $('miniNext').onclick = $('next').onclick = () => player.next();
  $('prev').onclick = () => player.prev();
  $('shuffle').onclick = () => player.toggleShuffle();
  $('repeat').onclick = () => player.cycleRepeat();
  const seek = $('seek');
  seek.oninput = () => { dragging = true; $('tNow').textContent = fmt(Number(seek.value)); };
  seek.onchange = () => { player.seek(Number(seek.value)); dragging = false; };

  function scrollQueue() {
    $('queue').querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
  }

  function renderQueue(q) {
    const ol = $('queue');
    ol.textContent = '';
    const frag = document.createDocumentFragment();
    q.order.forEach((idx, pos) => {
      const t = q.items[idx];
      const li = el('li', { className: 'row', tabIndex: 0 },
        el('span', { className: 'title', textContent: t.title }),
        el('span', { className: 'sub', textContent: t.artist }));
      li.onclick = () => { if (canPlay(t)) player.playAt(pos); };
      frag.append(li);
    });
    ol.append(frag);
  }

  return function update(s) {
    const t = s.track;
    $('mini').hidden = !t;
    if (!t) return;
    const pauseLabel = s.playing ? 'Pausar' : 'Tocar';
    for (const b of [$('miniToggle'), $('toggle')]) { b.textContent = s.playing ? '⏸︎' : '▶︎'; b.ariaLabel = pauseLabel; }
    const sub = s.loading ? 'Carregando…' : `${t.artist} · ${t.album}`;
    $('miniSub').textContent = sub;
    $('fullSub').textContent = sub;
    $('shuffle').ariaPressed = String(s.queue.shuffle);
    $('repeat').ariaPressed = String(s.queue.repeat !== 'off');
    $('repeat').ariaLabel = REPEAT_LABEL[s.queue.repeat];
    $('repeat').textContent = s.queue.repeat === 'one' ? '🔂︎' : '🔁︎';
    if (!dragging) {
      seek.max = String(Math.floor(s.duration) || 0);
      seek.value = String(Math.floor(s.time));
      $('tNow').textContent = fmt(s.time);
    }
    $('tEnd').textContent = fmt(s.duration);

    if (shownOrder !== s.queue.order || shownItems !== s.queue.items) {
      renderQueue(s.queue);
      shownOrder = s.queue.order;
      shownItems = s.queue.items;
    }
    const rows = $('queue').children;
    $('queue').querySelector('[aria-current]')?.removeAttribute('aria-current');
    rows[s.queue.pos]?.setAttribute('aria-current', 'true');

    if (shownId !== t.id) {
      shownId = t.id;
      $('miniTitle').textContent = t.title;
      $('fullTitle').textContent = t.title;
      const cover = $('fullCover');
      cover.textContent = '';
      if (t.hasArt) {
        artUrl(t).then((url) => {
          if (url && shownId === t.id) cover.append(el('img', { src: url, alt: `Capa de ${t.album}` }));
        });
      }
      if (!$('full').hidden) scrollQueue();
    }
  };
}
