// Local storage for CocoaNotes. Everything is written to IndexedDB on this device first;
// the cloud only ever gets copies. Nothing here deletes data unless the person asks for it.

const NAME = 'cocoanotes', VER = 2
let dbp = null

function open() {
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('notebooks')) d.createObjectStore('notebooks', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'key' })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' })
      // v2: each page stored on its own, so a save writes only the page that changed.
      if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'k' }).createIndex('nb', 'nb')
      if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs', { keyPath: 'id' })
    }
    r.onsuccess = () => {
      const d = r.result
      d.onversionchange = () => { d.close(); dbp = null }
      res(d)
    }
    r.onerror = () => rej(r.error)
    r.onblocked = () => rej(new Error('Storage is busy in another tab'))
  })
  return dbp
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })

async function tx(stores, mode, fn) {
  const d = await open()
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode, { durability: 'strict' })
    let out
    Promise.resolve(fn(t)).then(v => { out = v }, rej)
    t.oncomplete = () => res(out)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error || new Error('Write was cancelled'))
  })
}

export const db = {
  get: (store, key) => tx([store], 'readonly', t => wrap(t.objectStore(store).get(key))),
  all: (store) => tx([store], 'readonly', t => wrap(t.objectStore(store).getAll())),
  put: (store, val) => tx([store], 'readwrite', t => { t.objectStore(store).put(val) }),
  del: (store, key) => tx([store], 'readwrite', t => { t.objectStore(store).delete(key) }),
  /** Several writes in one transaction, so a notebook and its pages are saved together or not at all. */
  byIndex: (store, index, key) => tx([store], 'readonly', t => wrap(t.objectStore(store).index(index).getAll(key))),
  keysByIndex: (store, index, key) => tx([store], 'readonly', t => wrap(t.objectStore(store).index(index).getAllKeys(key))),
  multi: (ops) => {
    const stores = [...new Set(ops.map(o => o[1]))]
    return tx(stores, 'readwrite', t => { for (const [op, s, v] of ops) op === 'put' ? t.objectStore(s).put(v) : t.objectStore(s).delete(v) })
  },
  async meta(key, val) {
    if (val === undefined) { const r = await db.get('meta', key); return r ? r.v : undefined }
    return db.put('meta', { key, v: val })
  }
}

/** Ask the browser not to clear our storage when space runs low (granted for home-screen apps). */
export async function persist() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch { return false }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16)

/** JSON without the in-memory caches (keys starting with _). */
export const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)))
