// Player: fila + áudio. A parte de áudio é a receita do protótipo v4 (commit cda528f), aprovada no iPhone
// com a tela bloqueada. Não mudar sem testar de novo no iPhone:
// - navigator.audioSession.type = 'playback' antes de tocar (sem isso a próxima faixa fica muda com a tela bloqueada);
// - dois <audio>: a próxima faixa é preparada no elemento parado e começa ~1 s antes do fim da atual;
//   o anterior só pausa depois que o novo já está tocando;
// - Media Session registrada de novo a cada faixa, com ⏮ ⏭ (seekbackward/seekforward nulos);
// - playbackState informado explicitamente. Limitação aceita: o ícone ▶/⏸ da tela de bloqueio pode ficar em ▶.
import { newQueue, current, trackAt, nextPos, prevPos, withShuffle, nextRepeat } from './queue.js';

/**
 * @param {object} o
 * @param {HTMLAudioElement} o.audio          elemento <audio> da página
 * @param {(id: string) => Promise<Blob>} o.download
 * @param {(track: object) => Promise<string|null>} o.artUrl  capa (URL) ou null
 * @param {string} o.fallbackArt               imagem quando a faixa não tem capa
 * @param {(state: object) => void} o.onUpdate
 * @param {(err: Error) => void} o.onError
 */
export function createPlayer({ audio, download, artUrl, fallbackArt, onUpdate, onError }) {
  const players = [audio, new Audio()];
  players[1].playsInline = true;
  players[1].preload = 'auto';
  let cur = 0; // qual elemento de players está tocando
  const urls = new Map(); // elemento -> blob URL atual
  let q = newQueue([], 0);
  let started = false; // já tocou algo desta fila
  let loading = false;
  let prefetch = null; // { pos, id, promise }
  let prepared = null; // { pos, id, el }: próxima faixa já carregada no elemento parado
  let advancing = false;
  const active = () => players[cur];

  const state = () => ({
    track: started ? current(q) : null,
    playing: started && !active().paused,
    loading,
    time: active().currentTime || 0,
    duration: active().duration || 0,
    queue: q,
  });
  const emit = () => onUpdate(state());

  function applyAudioSession() {
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
  }
  function setPlaybackState(s) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s;
  }
  function setSrc(el, blob) {
    if (urls.has(el)) URL.revokeObjectURL(urls.get(el));
    const url = URL.createObjectURL(blob);
    urls.set(el, url);
    el.src = url;
  }

  // Guarda as 3 últimas faixas na memória: "anterior" não precisa baixar de novo.
  const blobCache = new Map(); // track id -> blob
  function getBlob(track) {
    if (blobCache.has(track.id)) return Promise.resolve(blobCache.get(track.id));
    return download(track.id).then((blob) => {
      blobCache.set(track.id, blob);
      while (blobCache.size > 3) blobCache.delete(blobCache.keys().next().value);
      return blob;
    });
  }

  function startPrefetch() {
    const pos = nextPos(q, true);
    const t = trackAt(q, pos);
    if (!t || (prefetch?.pos === pos && prefetch.id === t.id)) return;
    const promise = getBlob(t);
    prefetch = { pos, id: t.id, promise };
    promise.then((blob) => {
      // Só prepara se ainda for a próxima (o usuário pode ter pulado ou mudado o aleatório).
      if (prefetch?.promise !== promise || nextPos(q, true) !== pos) return;
      const el = players[1 - cur];
      setSrc(el, blob);
      el.load();
      prepared = { pos, id: t.id, el };
    }).catch(() => { if (prefetch?.promise === promise) prefetch = null; });
  }

  async function setMediaSession(t, loadingText) {
    if (!('mediaSession' in navigator)) return;
    const meta = (art) => new MediaMetadata({
      title: t.title, artist: loadingText ?? t.artist, album: t.album,
      artwork: [{ src: art || fallbackArt, sizes: '512x512' }],
    });
    navigator.mediaSession.metadata = meta(null);
    registerActions(); // de novo a cada faixa: o iOS pode descartar os handlers ao trocar o elemento que toca
    if (!loadingText && t.hasArt) {
      const art = await artUrl(t).catch(() => null);
      if (art && current(q)?.id === t.id) navigator.mediaSession.metadata = meta(art);
    }
  }

  async function playPos(pos) {
    const t = trackAt(q, pos);
    if (!t) { emit(); return; } // fim da fila
    q = { ...q, pos };
    started = true;
    applyAudioSession();
    try {
      const old = active();
      let el;
      if (prepared?.pos === pos && prepared.id === t.id) el = prepared.el;
      else {
        if (!blobCache.has(t.id)) {
          loading = true;
          emit();
          setMediaSession(t, 'Carregando…'); // a tela de bloqueio mostra na hora para onde foi
        }
        const blob = await (prefetch?.pos === pos && prefetch.id === t.id ? prefetch.promise : getBlob(t));
        if (current(q)?.id !== t.id || q.pos !== pos) return; // pulou para outra enquanto baixava
        el = players[1 - cur];
        setSrc(el, blob);
      }
      prepared = null;
      prefetch = null;
      setMediaSession(t);
      cur = players.indexOf(el); // antes do play(), para os eventos do novo elemento contarem como ativos
      await el.play();
      if (el !== old) old.pause(); // só pausa a anterior depois que a nova já está tocando
      setPlaybackState('playing');
    } catch (err) {
      onError(err);
    } finally {
      loading = false;
      advancing = false;
      emit();
    }
  }

  for (const el of players) {
    el.addEventListener('playing', () => {
      if (el !== active()) return;
      startPrefetch();
      setPlaybackState('playing');
      emit();
    });
    el.addEventListener('ended', () => {
      if (el !== active() || advancing) return;
      const pos = nextPos(q, true);
      if (pos < 0) { setPlaybackState('paused'); emit(); return; }
      playPos(pos);
    });
    el.addEventListener('pause', () => {
      if (el !== active() || el.ended) return;
      setPlaybackState('paused');
      emit();
    });
    el.addEventListener('timeupdate', () => {
      if (el !== active() || !el.duration) return;
      const pos = nextPos(q, true);
      if (!advancing && pos >= 0 && prepared?.pos === pos && el.duration - el.currentTime < 1) {
        advancing = true;
        playPos(pos);
      }
      emit();
      if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
      try { navigator.mediaSession.setPositionState({ duration: el.duration, position: el.currentTime, playbackRate: 1 }); } catch {}
    });
  }

  function next() {
    const pos = nextPos(q, false);
    if (pos >= 0) playPos(pos);
  }
  function prev() {
    const r = prevPos(q, active().currentTime);
    if (r.restart) active().currentTime = 0;
    else playPos(r.pos);
  }
  function play() {
    if (!started) return playPos(q.pos);
    applyAudioSession();
    return active().play().catch(onError);
  }
  function pause() { active().pause(); }
  function toggle() { return !started || active().paused ? play() : pause(); }
  function seek(t) { if (started) active().currentTime = t; }

  // Com previoustrack/nexttrack e sem seekbackward/seekforward, o iOS mostra ⏮ ⏭ em vez de ±10 s.
  function registerActions() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch {} };
    set('play', () => play());
    set('pause', pause);
    set('nexttrack', next);
    set('previoustrack', prev);
    set('seekbackward', null);
    set('seekforward', null);
    set('seekto', (d) => seek(d.seekTime));
  }
  registerActions();

  // A próxima mudou de lugar: o que estava preparado não serve mais; prepara de novo.
  function queueChanged() {
    prepared = null;
    prefetch = null;
    if (started && !active().paused) startPrefetch();
    emit();
  }

  return {
    playList(list, index) { q = newQueue(list, index, { shuffle: q.shuffle, repeat: q.repeat }); prepared = null; prefetch = null; playPos(q.pos); },
    playAt(pos) { playPos(pos); },
    next, prev, play, pause, toggle, seek,
    toggleShuffle() { q = withShuffle(q, !q.shuffle); queueChanged(); },
    cycleRepeat() { q = { ...q, repeat: nextRepeat(q.repeat) }; queueChanged(); },
    get state() { return state(); },
  };
}
