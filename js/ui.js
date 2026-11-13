// Telas da biblioteca e do player (T6 a T13). Visual: direção "fita cassete" (ver PRODUCT.md e DESIGN.md).
// Só interface: nenhuma regra de tocar, baixar ou guardar mora aqui.
import { groupByArtist, searchTracks, sortTracks } from './library.js';
import { askText, confirmDialog, openSheet } from './dialogs.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};
/** Ícone desenhado do sprite do index.html (<symbol id="i-nome">). */
function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
const setIcon = (btn, name) => btn.querySelector('use').setAttribute('href', `#i-${name}`);

// Cores das etiquetas de fita das playlists: a mesma playlist sempre ganha a mesma cor.
const CHIPS = ['#F4D03F', '#FF6B2C', '#5CC8B5', '#F28DB2', '#9B8CFF', '#8FD16B'];
const chipColor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHIPS[h % CHIPS.length];
};
const count = (n) => `${n} música${n === 1 ? '' : 's'}`;
const TAB_TITLE = { songs: 'Músicas', artists: 'Artistas', playlists: 'Playlists' };

function emptyState(iconName, heading, text) {
  return el('div', { className: 'empty' }, icon(iconName), el('h2', { textContent: heading }), text ? el('p', { textContent: text }) : '');
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root     onde as listas são desenhadas
 * @param {HTMLElement} o.title    título da tela atual
 * @param {HTMLElement} o.countEl  etiqueta amarela com a contagem da tela atual
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
export function createLibraryUI({ root, title, countEl, back, search, tabs, getArt, onPlay, onlyDownloaded, isDownloaded, isAvailable, downloads, playlists, toast }) {
  let tracks = [];
  let tab = 'songs';
  let detail = null; // { kind: 'artist' | 'playlist', group } (playlist: group = { id })
  let editing = false; // detalhe de playlist em modo de edição (▲ ▼ ✕)
  let sel = null; // Set de IDs quando está selecionando várias músicas; senão null
  let selBar = null;
  let nowId = null; // faixa tocando agora (para marcar a linha)
  let nowPlaying = false;
  const artUrls = new Map(); // albumKey -> object URL (fica enquanto o app está aberto)
  let dlButtons = new Map(); // id -> [{ t, b }] dos botões de download na tela, para atualizar o %
  let progressEl = null; // linha de progresso da aba Baixadas, quando aberta
  const rowTpl = document.getElementById('row-tpl').content.firstElementChild;
  const setCount = (n) => { countEl.hidden = n == null; if (n != null) countEl.textContent = String(n); };

  // O botão de download de cada linha: ícone (baixar, na fila, baixada) ou a porcentagem enquanto baixa.
  function setDl(b, t) {
    const s = downloads.state(t.id);
    const pct = b.querySelector('.pct');
    b.classList.toggle('done', s === 'done');
    b.classList.toggle('busy', s === 'active');
    pct.textContent = s === 'active' ? `${downloads.percent(t.id)}%` : '';
    if (s === 'done') { setIcon(b, 'check'); b.ariaLabel = `Baixada. Toque para apagar o download de ${t.title}`; }
    else if (s === 'active') b.ariaLabel = `Baixando ${t.title}`;
    else if (s === 'queued') { setIcon(b, 'dots'); b.ariaLabel = `${t.title} na fila para baixar. Toque para tirar da fila`; }
    else { setIcon(b, 'download'); b.ariaLabel = `Baixar ${t.title}`; }
  }

  // Baixar todas / baixando / apagar downloads de um álbum, artista ou playlist.
  function bulkButton(list, what = 'todas') {
    const states = list.map((t) => downloads.state(t.id));
    const missing = states.filter((s) => !s).length;
    const btn = (text, onclick, disabled = false) => el('button', { className: 'btn', type: 'button', textContent: text, disabled, onclick });
    if (missing) {
      return btn(missing === list.length ? `Baixar ${what} (${missing})` : `Baixar as ${missing} que faltam`, () => downloads.add(list));
    }
    if (states.some((s) => s !== 'done')) return btn('Baixando…', null, true);
    return btn('Apagar downloads', () => downloads.removeAll(list));
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
    const byId = new Map(list.map((t) => [t.id, t]));
    const frag = document.createDocumentFragment();
    list.forEach((t, i) => {
      const li = rowTpl.cloneNode(true);
      li.dataset.id = t.id;
      li.classList.toggle('numbered', numbered);
      li.querySelector('.lead').textContent = numbered ? String(t.trackNo ?? i + 1).padStart(2, '0') : '';
      li.querySelector('.title').textContent = t.title;
      li.querySelector('.sub').textContent = showAlbum ? `${t.artist} · ${t.album}` : t.artist;
      if (t.removedFromDrive) li.querySelector('.meta').append(el('span', { className: 'tag', textContent: 'removida do Drive' }));
      if (!isAvailable(t)) { li.classList.add('off'); li.ariaDisabled = 'true'; } // sem internet e não baixada
      li.classList.toggle('sel', Boolean(sel?.has(t.id)));
      const b = li.querySelector('.dl');
      setDl(b, t);
      if (!dlButtons.has(t.id)) dlButtons.set(t.id, []);
      dlButtons.get(t.id).push({ t, b });
      frag.append(li);
    });
    ul.append(frag);
    // Um só ouvinte por lista (em vez de um por botão): rola leve mesmo com milhares de músicas.
    let pressTimer = 0;
    let pressed = 0; // hora do último toque longo: o clique que vem junto é ignorado
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
    ul.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li.row');
      if (!li || sel || e.target.closest('button')) return;
      const x = e.clientX, y = e.clientY;
      cancelPress();
      pressTimer = setTimeout(() => { pressTimer = 0; pressed = Date.now(); trackMenu(byId.get(li.dataset.id)); }, 500);
      li.onpointermove = (m) => { if (Math.hypot(m.clientX - x, m.clientY - y) > 10) cancelPress(); };
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ul.addEventListener(ev, cancelPress);
    ul.addEventListener('contextmenu', (e) => e.preventDefault());
    ul.onclick = (e) => {
      if (Date.now() - pressed < 700) return;
      const li = e.target.closest('li.row');
      if (!li) return;
      const t = byId.get(li.dataset.id);
      if (sel) {
        if (!sel.delete(t.id)) sel.add(t.id);
        li.classList.toggle('sel', sel.has(t.id));
        updateSelBar();
        return;
      }
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'dl') downloads.toggle(t);
      else onPlay(t, list);
    };
    ul.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li.row')) { e.preventDefault(); e.target.click(); }
    };
    return ul;
  }

  // Linha de artista, álbum ou playlist: etiqueta de fita, nome, resumo e seta.
  function groupList(groups, label, open, { chip = 'plain' } = {}) {
    const ul = el('ul', { className: 'tracks' });
    const frag = document.createDocumentFragment();
    for (const g of groups) {
      const l = label(g);
      const li = el('li', { className: `row group${chip ? '' : ' no-chip'}`, tabIndex: 0 });
      if (chip) li.append(el('span', { className: `chip${chip === 'plain' ? ' plain' : ''}`, style: chip === 'plain' ? '' : `--c:${chipColor(l.title)}` }));
      li.append(el('div', { className: 'meta' }, el('span', { className: 'title', textContent: l.title }), el('span', { className: 'sub', textContent: l.sub })), icon('chevron-right'));
      li.onclick = () => open(g);
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(g); } };
      frag.append(li);
    }
    ul.append(frag);
    return ul;
  }

  // ---- playlists ----
  const askName = (initial = '') => askText({
    title: initial ? 'Renomear playlist' : 'Nova playlist', label: 'Nome da playlist', initial, confirmLabel: initial ? 'Renomear' : 'Criar',
  });

  // Folha de baixo: escolhe a playlist (ou cria uma) para receber as faixas.
  function pickPlaylist(ids, onDone) {
    const done = async (id) => {
      const n = await playlists.add(id, ids);
      handle.close();
      onDone?.();
      toast(n ? `${count(n)} em "${playlists.get(id).name}".` : `Já estava em "${playlists.get(id).name}".`);
    };
    const list = el('ul', { className: 'sheet-list' });
    for (const pl of playlists.list()) {
      list.append(el('li', {}, el('button', {
        className: 'btn', type: 'button', onclick: () => done(pl.id),
      }, el('span', { className: 'chip', style: `--c:${chipColor(pl.name)}` }), `${pl.name} · ${count(pl.trackIds.length)}`)));
    }
    const create = el('button', {
      className: 'btn', type: 'button',
      onclick: async () => {
        const name = await askName();
        if (!name) return;
        const pl = await playlists.create(name);
        if (pl) await done(pl.id); else toast('Nome inválido.');
      },
    }, icon('plus'), 'Nova playlist');
    const sheet = el('dialog', { className: 'sheet', ariaLabel: 'Adicionar à playlist' },
      el('h2', { textContent: `Adicionar ${count(ids.length)} a…` }), list, create,
      el('button', { className: 'btn', type: 'button', textContent: 'Cancelar', onclick: () => handle.close() }));
    const handle = openSheet(sheet);
  }
  // Segurar o dedo numa música: menu com o que dá para fazer com ela.
  function trackMenu(t) {
    const item = (text, ic, fn) => el('button', { className: 'btn', type: 'button', onclick: () => { handle.close(); fn(); } }, icon(ic), text);
    const sheet = el('dialog', { className: 'sheet', ariaLabel: t.title },
      el('h2', { textContent: t.title }),
      item('Adicionar à playlist', 'plus', () => pickPlaylist([t.id])),
      ...(downloads.state(t.id) === 'done' ? [item('Apagar download', 'x', () => downloads.toggle(t))] : []),
      item('Selecionar várias', 'check', () => startSelect(t.id)),
      el('button', { className: 'btn', type: 'button', textContent: 'Cancelar', onclick: () => handle.close() }));
    const handle = openSheet(sheet);
  }

  const selected = () => tracks.filter((t) => sel?.has(t.id));
  function startSelect(id) { sel = new Set([id]); render(); }
  function endSelect() { if (sel) { sel = null; render(); } }
  function updateSelBar() {
    if (!selBar) return;
    const list = selected();
    selBar.querySelector('.count').textContent = list.length ? `${list.length} selecionada${list.length > 1 ? 's' : ''}` : 'Nenhuma selecionada';
    for (const b of selBar.querySelectorAll('[data-need]')) b.disabled = b.dataset.need === 'dl' ? !list.some((t) => downloads.state(t.id) === 'done') : !list.length;
  }
  function makeSelBar() {
    const b = (text, need, fn, cls = '') => { const x = el('button', { className: `btn ${cls}`, type: 'button', textContent: text, onclick: fn }); if (need) x.dataset.need = need; return x; };
    selBar = el('div', { className: 'selbar' }, el('span', { className: 'count' }),
      b('Adicionar à playlist', 'any', () => pickPlaylist(selected().map((t) => t.id), endSelect)),
      b('Apagar downloads', 'dl', async () => { await downloads.removeAll(selected()); endSelect(); }, 'danger'),
      b('Cancelar', null, endSelect));
    updateSelBar();
    return selBar;
  }
  const addAllButton = (list) => el('button', { className: 'btn', type: 'button', onclick: () => pickPlaylist(list.map((t) => t.id)) }, icon('plus'), 'Adicionar à playlist');

  function renderPlaylistList() {
    const all = playlists.list();
    setCount(all.length);
    root.append(el('div', { className: 'actions' }, el('button', {
      className: 'btn', type: 'button',
      onclick: async () => {
        const name = await askName();
        if (!name) return;
        const pl = await playlists.create(name);
        if (pl) openDetail('playlist', { id: pl.id }); else toast('Nome inválido.');
      },
    }, icon('plus'), 'Nova playlist')));
    if (!all.length) return root.append(emptyState('cassette', 'Nenhuma playlist ainda', 'Segure o dedo numa música e escolha "Adicionar à playlist".'));
    root.append(groupList(all, (pl) => ({ title: pl.name, sub: count(playlists.tracksOf(pl).length) }), (pl) => openDetail('playlist', { id: pl.id }), { chip: 'color' }));
  }

  // Modo de edição: ▲ ▼ mexem na ordem (em relação à faixa vizinha da lista) e ✕ tira da playlist.
  function editRows(pl, list) {
    const ul = el('ul', { className: 'tracks' });
    const ctl = (name, label, onclick, disabled = false) => el('button', { className: 'ctl', type: 'button', ariaLabel: label, disabled, onclick }, icon(name));
    list.forEach((t, i) => {
      const idx = pl.trackIds.indexOf(t.id);
      ul.append(el('li', { className: 'row edit' },
        el('div', { className: 'meta' }, el('span', { className: 'title', textContent: t.title }), el('span', { className: 'sub', textContent: t.artist })),
        el('span', { className: 'ctls' },
          ctl('up', `Subir ${t.title}`, () => playlists.move(pl.id, idx, pl.trackIds.indexOf(list[i - 1].id)), i === 0),
          ctl('chevron-down', `Descer ${t.title}`, () => playlists.move(pl.id, idx, pl.trackIds.indexOf(list[i + 1].id)), i === list.length - 1),
          ctl('x', `Tirar ${t.title} da playlist`, () => playlists.removeAt(pl.id, idx)))));
    });
    return ul;
  }

  function renderPlaylist(id) {
    const pl = playlists.get(id);
    if (!pl) { detail = null; return render(); } // foi apagada
    title.textContent = pl.name;
    const list = playlists.tracksOf(pl);
    setCount(list.length);
    const hidden = pl.trackIds.length - list.length;
    if (hidden) root.append(el('p', { className: 'note', textContent: `${hidden} música(s) desta playlist não estão mais na biblioteca.` }));
    root.append(el('div', { className: 'actions' },
      el('button', { className: 'btn primary', type: 'button', disabled: !list.some(isAvailable), onclick: () => onPlay(list.find(isAvailable), list) }, icon('play'), 'Tocar'),
      el('button', { className: 'btn', type: 'button', textContent: editing ? 'Pronto' : 'Editar', onclick: () => { editing = !editing; render(); } }),
      ...(list.length ? [bulkButton(list, 'playlist')] : [])));
    if (!list.length) root.append(emptyState('cassette', 'Playlist vazia', 'Segure o dedo numa música e escolha "Adicionar à playlist".'));
    else root.append(editing ? editRows(pl, list) : trackList(list, { numbered: true }));
    if (editing) {
      root.append(el('div', { className: 'actions' },
        el('button', { className: 'btn', type: 'button', textContent: 'Renomear', onclick: async () => { const name = await askName(pl.name); if (name) playlists.rename(pl.id, name); } }),
        el('button', {
          className: 'btn danger', type: 'button', textContent: 'Apagar playlist',
          onclick: async () => {
            const ok = await confirmDialog({
              title: `Apagar "${pl.name}"?`, text: 'As músicas e os downloads não são apagados, só a playlist.', confirmLabel: 'Apagar playlist',
            });
            if (!ok) return;
            editing = false;
            detail = null;
            playlists.remove(pl.id);
          },
        })));
    }
  }

  function openDetail(kind, group) {
    detail = { kind, group };
    editing = false;
    sel = null;
    window.scrollTo(0, 0);
    render();
  }

  // Desenha a tela atual. Sempre termina marcando a linha que está tocando.
  function build() {
    root.textContent = '';
    root.classList.toggle('selecting', Boolean(sel));
    selBar = null;
    if (sel) root.append(makeSelBar());
    dlButtons = new Map();
    progressEl = null;
    const q = search.value;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    back.hidden = !detail;
    search.hidden = Boolean(detail) || tab === 'playlists';
    onlyDownloaded.parentElement.hidden = search.hidden; // o filtro só vale para as listas de músicas

    if (detail?.kind === 'playlist') return renderPlaylist(detail.group.id);
    if (detail?.kind === 'artist') {
      title.textContent = detail.group.artist;
      setCount(detail.group.tracks.length);
      return root.append(el('div', { className: 'actions' }, bulkButton(detail.group.tracks), addAllButton(detail.group.tracks)),
        trackList(detail.group.tracks));
    }
    title.textContent = TAB_TITLE[tab];
    if (tab === 'playlists') return renderPlaylistList();

    const pool = onlyDownloaded.checked ? tracks.filter(isDownloaded) : tracks;
    const found = searchTracks(pool, q);
    if (!tracks.length) {
      setCount(null);
      return root.append(emptyState('cassette', 'Nenhuma música ainda', 'Entre com o Google e toque em atualizar para carregar a pasta Músicas do seu Drive.'));
    }
    if (tab === 'songs' && onlyDownloaded.checked) { // espaço usado e andamento dos downloads (antes ficava na aba Baixadas)
      const space = el('p', { className: 'status', textContent: 'Calculando o espaço…' });
      downloads.spaceText().then((text) => { space.textContent = text; }).catch(() => { space.textContent = ''; });
      progressEl = el('p', { className: 'status', textContent: downloads.progressText() });
      root.append(el('div', { className: 'panel' }, space, progressEl));
    }
    if (!pool.length) { setCount(0); return root.append(emptyState('download', 'Nenhuma música baixada', 'Toque no ícone de baixar numa música.')); }
    if (!found.length) { setCount(0); return root.append(emptyState('cassette', 'Nada encontrado', `Nenhuma música com "${q}".`)); }

    if (tab === 'songs') {
      setCount(found.length);
      root.append(trackList(sortTracks(found)));
    } else if (tab === 'artists') {
      const groups = groupByArtist(found);
      setCount(groups.length);
      root.append(groupList(groups, (g) => ({ title: g.artist, sub: `${g.albums.length} álbum(ns) · ${count(g.tracks.length)}` }), (g) => openDetail('artist', g), { chip: null }));
    }
  }

  // Marca a linha que está tocando: fundo mais claro, título laranja e três barrinhas que só se mexem enquanto toca.
  function markNow() {
    root.classList.toggle('is-playing', nowPlaying);
    root.querySelector('[aria-current]')?.removeAttribute('aria-current');
    root.querySelector('.eq')?.remove();
    if (!nowId) return;
    const li = root.querySelector(`li.row[data-id="${CSS.escape(nowId)}"]`);
    if (!li) return;
    li.setAttribute('aria-current', 'true');
    li.append(el('span', { className: 'eq', ariaHidden: 'true' }, el('i'), el('i'), el('i')));
  }

  function render() {
    const r = build();
    markNow();
    return r;
  }

  for (const b of tabs) b.onclick = () => { tab = b.dataset.tab; detail = null; editing = false; sel = null; render(); };
  back.onclick = () => { detail = null; editing = false; sel = null; render(); };
  search.oninput = render;
  onlyDownloaded.onchange = () => { detail = null; editing = false; sel = null; render(); };

  return {
    refresh: render, // a internet caiu ou voltou, ou um download mudou: redesenha sem sair da tela atual
    // Só o % de uma faixa mudou: atualiza o botão dela e a linha de progresso, sem redesenhar a lista.
    updateDownload(id) {
      for (const { t, b } of dlButtons.get(id) ?? []) setDl(b, t);
      if (progressEl) progressEl.textContent = downloads.progressText();
    },
    setNowPlaying(id, playing) {
      if (id === nowId && playing === nowPlaying) return;
      const sameTrack = id === nowId;
      nowId = id;
      nowPlaying = playing;
      if (sameTrack) root.classList.toggle('is-playing', playing);
      else markNow();
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

// ---- mini player e tela cheia ----
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
  const seek = $('seek');

  const openFull = () => { $('full').hidden = false; document.body.classList.add('full-open'); $('full').scrollTop = 0; $('fullClose').focus(); };
  const closeFull = () => { $('full').hidden = true; document.body.classList.remove('full-open'); $('miniOpen').focus(); };
  $('miniOpen').onclick = openFull;
  $('fullClose').onclick = closeFull;
  $('full').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFull(); });
  $('miniToggle').onclick = $('toggle').onclick = () => player.toggle();
  $('miniNext').onclick = $('next').onclick = () => player.next();
  $('prev').onclick = () => player.prev();
  $('shuffle').onclick = () => player.toggleShuffle();
  $('repeat').onclick = () => player.cycleRepeat();
  const fill = () => seek.style.setProperty('--seekp', `${seek.max > 0 ? (Number(seek.value) / Number(seek.max)) * 100 : 0}%`);
  seek.oninput = () => { dragging = true; $('tNow').textContent = fmt(Number(seek.value)); fill(); };
  seek.onchange = () => { player.seek(Number(seek.value)); dragging = false; };

  function renderQueue(q) {
    const ol = $('queue');
    ol.textContent = '';
    const frag = document.createDocumentFragment();
    q.order.forEach((idx, pos) => {
      const t = q.items[idx];
      const li = el('li', { className: 'row', tabIndex: 0 },
        el('div', { className: 'meta' }, el('span', { className: 'title', textContent: t.title }), el('span', { className: 'sub', textContent: t.artist })));
      li.onclick = () => { if (canPlay(t)) player.playAt(pos); };
      li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); } };
      frag.append(li);
    });
    ol.append(frag);
  }

  return function update(s) {
    const t = s.track;
    $('mini').hidden = !t;
    if (!t) return;
    // A fita: quanto da música já passou (0 a 1) decide o tamanho dos dois carretéis.
    const p = s.duration ? Math.min(1, Math.max(0, s.time / s.duration)) : 0;
    for (const node of [$('mini'), $('cassette')]) {
      node.style.setProperty('--p', p.toFixed(3));
      node.classList.toggle('playing', s.playing);
      node.classList.toggle('loading', s.loading);
    }
    for (const b of [$('miniToggle'), $('toggle')]) { setIcon(b, s.playing ? 'pause' : 'play'); b.ariaLabel = s.playing ? 'Pausar' : 'Tocar'; }
    const sub = s.loading ? 'Carregando…' : `${t.artist} · ${t.album}`;
    $('miniSub').textContent = sub;
    $('fullSub').textContent = sub;
    $('shuffle').ariaPressed = String(s.queue.shuffle);
    $('repeat').ariaPressed = String(s.queue.repeat !== 'off');
    $('repeat').ariaLabel = REPEAT_LABEL[s.queue.repeat];
    setIcon($('repeat'), s.queue.repeat === 'one' ? 'repeat-one' : 'repeat');
    if (!dragging) {
      seek.max = String(Math.floor(s.duration) || 0);
      seek.value = String(Math.floor(s.time));
      seek.setAttribute('aria-valuetext', `${fmt(s.time)} de ${fmt(s.duration)}`);
      fill();
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
      $('fullAlbum').textContent = t.album;
      // Sem capa nas tags, a fita desenhada ocupa o lugar; com capa, ela aparece no lugar da fita.
      const art = $('fullCover');
      art.querySelector('img')?.remove();
      art.classList.remove('has-cover');
      if (t.hasArt) {
        artUrl(t).then((url) => {
          if (url && shownId === t.id) { art.append(el('img', { src: url, alt: `Capa de ${t.album}` })); art.classList.add('has-cover'); }
        });
      }
    }
  };
}
