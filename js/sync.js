// Cloud copies on Google Drive and Yandex Disk. Notes are always saved on this device first.
// Every upload waits in an outbox kept in IndexedDB, so it survives closing the app, going offline
// or a failed request; it is retried automatically with growing pauses until it succeeds.
import { db, clean } from './db.js'
import { state, settings, saveSettings, on as onStore, openDoc, importNotebook, blobIds } from './store.js'
import { CONFIG } from './config.js'

const L = new Set()
export const onSync = (fn) => (L.add(fn), () => L.delete(fn))
const emit = () => L.forEach(f => f())

const BACKOFF = [5, 15, 30, 60, 120, 300, 600]
const info = { gdrive: { needsAuth: false, lastOk: 0, lastErr: '' }, yandex: { needsAuth: false, lastOk: 0, lastErr: '' }, busy: false, pending: 0, nextAt: 0, pulling: false }
export const syncInfo = info

class AuthError extends Error { }
const isOnline = () => navigator.onLine !== false

// ---------------- Google Drive

const G = {
  id: 'gdrive', name: 'Google Drive',
  cfg: () => settings.cloud.gdrive,
  clientId: () => settings.googleClientId || CONFIG.googleClientId,
  connected: () => !!settings.cloud.gdrive,
  ready: () => { const c = settings.cloud.gdrive; return !!(c && c.token && c.exp > Date.now() + 30000) },
  tokenClient: null,
  async loadGIS() {
    if (window.google?.accounts?.oauth2) return
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not reach Google sign-in')); document.head.appendChild(s) })
  },
  /** Must run from a tap or click: it may open Google's sign-in window. */
  async connect(silent = false) {
    if (!G.clientId()) throw new Error('Add a Google client ID in Settings, Cloud sync first')
    await G.loadGIS()
    return new Promise((res, rej) => {
      G.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: G.clientId(), scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (r) => {
          if (r.error) return rej(new Error(r.error_description || r.error))
          const prev = settings.cloud.gdrive || {}
          settings.cloud.gdrive = { ...prev, token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000, ids: prev.ids || {} }
          saveSettings()
          info.gdrive.needsAuth = false
          res()
          kick()
          enqueueAll()
        },
        error_callback: (e) => rej(new Error(e?.message || 'Sign-in was closed'))
      })
      G.tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' })
    })
  },
  disconnect() {
    const t = settings.cloud.gdrive?.token
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => { })
    settings.cloud.gdrive = null; saveSettings()
  },
  async api(url, opt = {}) {
    if (!G.ready()) throw new AuthError('Google Drive sign-in expired')
    const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + G.cfg().token, ...(opt.headers || {}) } })
    if (r.status === 401 || r.status === 403 && /auth/i.test(await r.clone().text())) { G.cfg().exp = 0; saveSettings(); throw new AuthError('Google Drive sign-in expired') }
    if (!r.ok) throw new Error('Google Drive ' + r.status)
    return r
  },
  async folder() {
    const c = G.cfg()
    if (c.folder) return c.folder
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='CocoaNotes' and trashed=false")
    const r = await (await G.api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()
    if (r.files?.length) c.folder = r.files[0].id
    else {
      const f = await (await G.api('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CocoaNotes', mimeType: 'application/vnd.google-apps.folder' }) })).json()
      c.folder = f.id
    }
    saveSettings()
    return c.folder
  },
  async findId(name) {
    const c = G.cfg()
    if (c.ids[name]) return c.ids[name]
    const folder = await G.folder()
    const q = encodeURIComponent(`'${folder}' in parents and name='${name}' and trashed=false`)
    const r = await (await G.api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json()
    if (r.files?.length) { c.ids[name] = r.files[0].id; saveSettings() }
    return c.ids[name] || null
  },
  async put(name, blob, props) {
    const folder = await G.folder()
    const id = await G.findId(name)
    const meta = { name, appProperties: props || {} }
    if (!id) meta.parents = [folder]
    const B = 'cn' + Math.random().toString(36).slice(2)
    const body = new Blob([`--${B}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify(meta), `\r\n--${B}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${B}--`])
    const url = id ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id'
    try {
      const r = await (await G.api(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + B }, body })).json()
      G.cfg().ids[name] = r.id; saveSettings()
    } catch (e) {
      // The file may have been removed on Drive; forget its id so the next try creates it again.
      if (id && /404/.test(e.message)) { delete G.cfg().ids[name]; saveSettings() }
      throw e
    }
  },
  async list() {
    const folder = await G.folder()
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false and appProperties has { key='kind' and value='nb' }`)
    const out = []
    let page = ''
    do {
      const r = await (await G.api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)${page ? '&pageToken=' + page : ''}`)).json()
      for (const f of r.files || []) { G.cfg().ids[f.name] = f.id; out.push({ name: f.name, updated: +(f.appProperties?.updated || 0), id: f.appProperties?.nbId }) }
      page = r.nextPageToken
    } while (page)
    saveSettings()
    return out
  },
  async get(name) {
    const id = await G.findId(name)
    if (!id) return null
    return (await G.api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).blob()
  },
  async remove(name) {
    const id = await G.findId(name)
    if (!id) return
    try { await G.api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }) } catch (e) { if (!/404/.test(e.message)) throw e }
    delete G.cfg().ids[name]; saveSettings()
  }
}

// ---------------- Yandex Disk

const Y = {
  id: 'yandex', name: 'Yandex Disk',
  cfg: () => settings.cloud.yandex,
  clientId: () => settings.yandexClientId || CONFIG.yandexClientId,
  connected: () => !!settings.cloud.yandex,
  ready: () => { const c = settings.cloud.yandex; return !!(c && c.token && c.exp > Date.now() + 30000) },
  connect() {
    if (!Y.clientId()) throw new Error('Add a Yandex client ID in Settings, Cloud sync first')
    const redirect = location.origin + location.pathname
    location.href = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${encodeURIComponent(Y.clientId())}&redirect_uri=${encodeURIComponent(redirect)}&state=yandex&force_confirm=yes`
  },
  /** Picks up the token Yandex sends back in the address after sign-in. */
  takeToken() {
    if (!location.hash.includes('access_token') || !location.hash.includes('state=yandex')) return false
    const p = new URLSearchParams(location.hash.slice(1))
    settings.cloud.yandex = { token: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 31536000) * 1000 }
    saveSettings()
    history.replaceState(null, '', location.pathname + location.search)
    info.yandex.needsAuth = false
    return true
  },
  disconnect() { settings.cloud.yandex = null; saveSettings() },
  async api(path, opt = {}) {
    if (!Y.ready()) throw new AuthError('Yandex Disk sign-in expired')
    const r = await fetch('https://cloud-api.yandex.net/v1/disk/' + path, { ...opt, headers: { Authorization: 'OAuth ' + Y.cfg().token, ...(opt.headers || {}) } })
    if (r.status === 401) { Y.cfg().exp = 0; saveSettings(); throw new AuthError('Yandex Disk sign-in expired') }
    return r
  },
  async folder() {
    if (Y.cfg().folder) return
    const r = await Y.api('resources?path=' + encodeURIComponent('app:/CocoaNotes'), { method: 'PUT' })
    if (!r.ok && r.status !== 409) throw new Error('Yandex Disk ' + r.status)
    Y.cfg().folder = true; saveSettings()
  },
  p: (name) => encodeURIComponent('app:/CocoaNotes/' + name),
  async put(name, blob, props) {
    await Y.folder()
    const r = await Y.api(`resources/upload?path=${Y.p(name)}&overwrite=true`)
    if (!r.ok) throw new Error('Yandex Disk ' + r.status)
    const { href, method } = await r.json()
    const up = await fetch(href, { method: method || 'PUT', body: blob })
    if (!up.ok && up.status !== 201 && up.status !== 202) throw new Error('Yandex Disk upload ' + up.status)
    if (props) {
      const pr = await Y.api(`resources?path=${Y.p(name)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ custom_properties: props }) })
      if (!pr.ok) throw new Error('Yandex Disk ' + pr.status)
    }
  },
  async list() {
    await Y.folder()
    const out = []
    let offset = 0
    for (;;) {
      const r = await Y.api(`resources?path=${encodeURIComponent('app:/CocoaNotes')}&limit=500&offset=${offset}&fields=_embedded.items.name,_embedded.items.custom_properties,_embedded.total`)
      if (!r.ok) throw new Error('Yandex Disk ' + r.status)
      const j = await r.json()
      const items = j._embedded?.items || []
      for (const f of items) if (f.custom_properties?.kind === 'nb') out.push({ name: f.name, updated: +(f.custom_properties.updated || 0), id: f.custom_properties.nbId })
      offset += items.length
      if (!items.length || offset >= (j._embedded?.total || 0)) break
    }
    return out
  },
  async get(name) {
    const r = await Y.api(`resources/download?path=${Y.p(name)}`)
    if (r.status === 404) return null
    if (!r.ok) throw new Error('Yandex Disk ' + r.status)
    const { href } = await r.json()
    const d = await fetch(href)
    if (!d.ok) throw new Error('Yandex Disk download ' + d.status)
    return d.blob()
  },
  async remove(name) {
    const r = await Y.api(`resources?path=${Y.p(name)}&permanently=false`, { method: 'DELETE' })
    if (!r.ok && r.status !== 404 && r.status !== 202 && r.status !== 204) throw new Error('Yandex Disk ' + r.status)
  }
}

export const PROVIDERS = { gdrive: G, yandex: Y }
const connected = () => Object.values(PROVIDERS).filter(p => p.connected())

// ---------------- outbox

const nbName = (id) => id + '.cnote'
const blobName = (id) => 'img-' + id

async function uploadedSet(pid) { return new Set((await db.meta('up.' + pid)) || []) }
async function markUploaded(pid, id) { const s = await uploadedSet(pid); s.add(id); await db.meta('up.' + pid, [...s]) }

async function enqueue(pid, kind, ref) {
  const key = `${pid}|${kind}|${ref}`
  const cur = await db.get('outbox', key)
  // A newer change resets the wait, so it goes out promptly.
  await db.put('outbox', { key, pid, kind, ref, tries: cur && kind !== 'nb' ? cur.tries : 0, next: 0, err: '', at: Date.now() })
}

export async function enqueueNotebook(id) {
  const provs = connected()
  if (!provs.length) return
  const doc = state.docs.get(id) || await db.get('docs', id)
  for (const p of provs) {
    if (doc) {
      const up = await uploadedSet(p.id)
      for (const b of blobIds(doc)) if (!up.has(b)) await enqueue(p.id, 'blob', b)
    }
    await enqueue(p.id, 'nb', id)
  }
  kick()
}

export async function enqueueDelete(id) {
  const del = new Set((await db.meta('tombstones')) || []); del.add(id); await db.meta('tombstones', [...del])
  for (const p of connected()) {
    await db.del('outbox', `${p.id}|nb|${id}`)
    await enqueue(p.id, 'del', id)
  }
  kick()
}

/** After connecting a service, everything already on this device is copied up. */
async function enqueueAll() {
  for (const nb of state.notebooks.values()) {
    for (const p of connected()) if ((nb.base?.[p.id] || 0) < nb.updated) await enqueueNotebook(nb.id)
  }
  pull()
}

let timer = 0, running = false
export function kick(delay = 300) { clearTimeout(timer); timer = setTimeout(run, delay) }

async function run() {
  if (running) return
  running = true
  try {
    const all = await db.all('outbox')
    info.pending = all.length
    const now = Date.now()
    if (!isOnline()) { info.nextAt = 0; return }
    const blobWait = new Set()
    // Pictures first, so a notebook never arrives before the images it shows.
    const order = { blob: 0, nb: 1, del: 2 }
    for (const e of all) if (e.kind === 'blob' && e.next > now) blobWait.add(e.pid)
    const due = all.filter(e => e.next <= now).sort((a, b) => order[a.kind] - order[b.kind] || a.at - b.at)
    const blocked = new Set()
    if (due.length) { info.busy = true; emit() }
    for (const e of due) {
      const p = PROVIDERS[e.pid]
      if (!p || !p.connected()) { await db.del('outbox', e.key); continue }
      if (blocked.has(e.pid)) continue
      if (!p.ready()) { info[e.pid].needsAuth = true; blocked.add(e.pid); continue }
      // A notebook waits until every picture it needs has arrived.
      if (e.kind === 'nb' && blobWait.has(e.pid)) continue
      try {
        await send(p, e)
        await db.del('outbox', e.key)
        info[e.pid].lastOk = Date.now()
        info[e.pid].lastErr = ''
      } catch (err) {
        if (err instanceof AuthError) { info[e.pid].needsAuth = true; blocked.add(e.pid) }
        if (e.kind === 'blob') blobWait.add(e.pid)
        const tries = (e.tries || 0) + 1
        const wait = BACKOFF[Math.min(tries - 1, BACKOFF.length - 1)] * 1000 * (0.85 + Math.random() * 0.3)
        info[e.pid].lastErr = err.message || String(err)
        await db.put('outbox', { ...e, tries, next: Date.now() + wait, err: info[e.pid].lastErr })
        if (!isOnline()) break
      }
    }
  } catch (err) {
    console.warn('sync', err)
  } finally {
    running = false
    info.busy = false
    const left = await db.all('outbox').catch(() => [])
    info.pending = left.length
    let waiting = left.filter(e => PROVIDERS[e.pid]?.ready())
    // A notebook waiting on its pictures goes when they do.
    waiting = waiting.filter(e => !(e.kind === 'nb' && waiting.some(x => x.kind === 'blob' && x.pid === e.pid)))
    info.nextAt = waiting.length ? Math.min(...waiting.map(e => e.next)) : 0
    if (info.nextAt) { clearTimeout(timer); timer = setTimeout(run, Math.max(500, info.nextAt - Date.now())) }
    emit()
  }
}

async function send(p, e) {
  if (e.kind === 'blob') {
    const r = await db.get('blobs', e.ref)
    if (!r) return
    await p.put(blobName(e.ref), r.blob, { kind: 'blob' })
    await markUploaded(p.id, e.ref)
  } else if (e.kind === 'nb') {
    // Upload exactly what is saved on this device.
    const nb = await db.get('notebooks', e.ref)
    if (!nb) return
    const doc = await db.get('docs', e.ref)
    const meta = clean(nb); delete meta.thumb; delete meta.base
    const file = new Blob([JSON.stringify({ app: 'CocoaNotes', v: 1, nb: meta, doc })], { type: 'application/json' })
    await p.put(nbName(nb.id), file, { kind: 'nb', nbId: nb.id, updated: String(nb.updated) })
    // Record what this service now has, without touching anything written meanwhile.
    const live = state.notebooks.get(nb.id)
    if (live) live.base = { ...(live.base || {}), [p.id]: nb.updated }
    const cur = await db.get('notebooks', nb.id)
    if (cur) { cur.base = { ...(cur.base || {}), [p.id]: nb.updated }; await db.put('notebooks', cur) }
  } else if (e.kind === 'del') {
    await p.remove(nbName(e.ref))
  }
}

// ---------------- bringing in changes from other devices

let lastPull = 0
export async function pull() {
  if (info.pulling || !isOnline()) return
  info.pulling = true; emit()
  lastPull = Date.now()
  const tomb = new Set((await db.meta('tombstones')) || [])
  try {
    for (const p of connected()) {
      if (!p.ready()) { info[p.id].needsAuth = true; continue }
      let list
      try { list = await p.list() } catch (err) { if (err instanceof AuthError) info[p.id].needsAuth = true; info[p.id].lastErr = err.message; continue }
      for (const r of list) {
        const id = r.id || r.name.replace(/\.cnote$/, '')
        if (tomb.has(id)) continue
        const local = state.notebooks.get(id)
        const base = local?.base?.[p.id] || 0
        if (local && r.updated <= local.updated) {
          if (r.updated === local.updated && base !== r.updated) { local.base = { ...(local.base || {}), [p.id]: r.updated }; await db.put('notebooks', local) }
          continue
        }
        if (local && window.__cnOpen === id) continue
        const blob = await p.get(r.name).catch(() => null)
        if (!blob) continue
        let data
        try { data = JSON.parse(await blob.text()) } catch { continue }
        if (data.app !== 'CocoaNotes') continue
        // Pictures this device does not have yet.
        for (const b of blobIds(data.doc)) {
          if (await db.get('blobs', b)) continue
          const img = await p.get(blobName(b)).catch(() => null)
          if (img) { await db.put('blobs', { id: b, blob: img, type: img.type, created: Date.now() }); await markUploaded(p.id, b) }
        }
        if (local && local.updated > base) {
          // Changed here and elsewhere: keep both, nothing is overwritten.
          const copyId = id + 'x' + Date.now().toString(36).slice(-4)
          const nb = { ...data.nb, id: copyId, title: data.nb.title + ' (other device)', base: {} }
          await importNotebook(nb, { ...data.doc, id: copyId })
          await enqueueNotebook(copyId)
        } else {
          const nb = { ...data.nb, base: { ...(local?.base || {}), [p.id]: data.nb.updated }, thumb: local?.thumb }
          state.docs.delete(id)
          await importNotebook(nb, data.doc)
        }
      }
    }
  } finally {
    info.pulling = false
    emit()
  }
}

// ---------------- wiring

export function startSync() {
  if (Y.takeToken()) setTimeout(enqueueAll, 300)
  onStore((ev, id) => { if (ev === 'saved') enqueueNotebook(id) })
  addEventListener('online', () => { db.all('outbox').then(all => Promise.all(all.map(e => db.put('outbox', { ...e, next: 0 })))).then(() => kick(100)); pull() })
  addEventListener('offline', emit)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    kick(200)
    if (Date.now() - lastPull > 60000) pull()
  })
  setInterval(() => { if (document.visibilityState === 'visible') { kick(0); if (Date.now() - lastPull > 180000) pull() } }, 30000)
  kick(800)
  setTimeout(pull, 1500)
}

/** Try everything waiting right now (the "Retry now" button). */
export async function retryNow() {
  const all = await db.all('outbox')
  await Promise.all(all.map(e => db.put('outbox', { ...e, next: 0 })))
  kick(0)
}

export const online = isOnline
