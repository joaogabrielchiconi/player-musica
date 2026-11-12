// IndexedDB do app: um banco, um store por tipo de dado, chaves explícitas (out-of-line).
const DB_NAME = 'player-musica';
const DB_VERSION = 1;
export const STORES = ['tracks', 'audio', 'art', 'playlists', 'state', 'meta'];

let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba abriu uma versão nova do banco: fecha esta conexão para não travar a atualização.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Banco bloqueado: feche outras abas do app.')); };
  });
  return dbPromise;
}

// Resolve só quando a transação termina (dado gravado de fato), não quando o pedido é aceito.
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transação cancelada.'));
  });
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const keys = (store) => run(store, 'readonly', (s) => s.getAllKeys());

// Pede ao navegador para não apagar os dados quando faltar espaço. Retorna se ficou persistente.
export async function persist() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
