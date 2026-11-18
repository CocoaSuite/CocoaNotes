// Notebooks in memory, saved to this device as you write. A change is never dropped: if a save
// fails it stays queued and is tried again, and the cloud copy is only made from what was saved here.
import { db, uid, clean } from './db.js'
import { A4, drawPage, PAPERS, drawLining, drawItems } from './render.js'
import { bbox } from './ink.js'
import { packItems, unpackItems, itemsToJSON, itemsFromJSON, packedSize } from './codec.js'

const listeners = new Set()
export const on = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = (ev, data) => listeners.forEach(f => f(ev, data))

export const SUBJECT_COLORS = ['#F5913E', '#6fbf8a', '#d98bb0', '#8AA7D9', '#d9c36a', '#a58ad9', '#5fb8c2', '#e07a6a']

const DEF_SETTINGS = {
  ux: 'classic', sounds: null, haptics: true, onboarded: false,
  penOnly: 'auto', palm: true, hover: true, tray: 'bottom', twoFingerUndo: true,
  railOpen: true, defLining: 'college', defPaper: 'white', defCanvasLining: 'dotted',
  pens: null, color: '#23324d', recent: ['#23324d', '#1c1c1c', '#c0562a', '#2f7d55'],
  nib: 40, pressure: true, shape: 'line', textFont: 'sans', textSize: 22,
  cloud: { gdrive: null, yandex: null, primary: 'gdrive', cellular: true },
  googleClientId: '', yandexClientId: ''
}

function loadSettings() {
  try { return { ...DEF_SETTINGS, ...JSON.parse(localStorage.getItem('cocoanotes.settings') || '{}') } } catch { return { ...DEF_SETTINGS } }
}
export const settings = loadSettings()
export function saveSettings() { try { localStorage.setItem('cocoanotes.settings', JSON.stringify(settings)) } catch { } emit('settings') }

export const state = { notebooks: new Map(), subjects: [], docs: new Map(), saving: false, saveError: null }

export async function load() {
  const [nbs, subj] = await Promise.all([db.all('notebooks'), db.meta('subjects')])
  for (const nb of nbs) { if (nb.thumb) { delete nb.thumb; db.put('notebooks', nb) } state.notebooks.set(nb.id, nb) }
  state.subjects = subj || [
    { id: 's1', name: 'General', color: SUBJECT_COLORS[0] }
  ]
}

export async function saveSubjects() { await db.meta('subjects', state.subjects); emit('subjects') }

export function newDoc(nb) {
  return { id: nb.id, pages: [{ id: uid(), items: [] }] }
}

export async function createNotebook(o) {
  const now = Date.now()
  const nb = {
    id: uid(), title: o.title || (o.type === 'canvas' ? 'Untitled canvas' : 'Untitled journal'),
    type: o.type, orient: o.orient || 'v', lining: o.lining, paper: o.paper || 'white',
    cover: o.cover || '#F5913E', subject: o.subject || null,
    created: now, updated: now, pages: 1, trashed: false, base: {}
  }
  const doc = newDoc(nb)
  state.notebooks.set(nb.id, nb)
  state.docs.set(nb.id, doc)
  await writeDoc(nb, doc)
  emit('notebooks')
  emit('saved', nb.id)
  return nb
}

const pageKey = (nb, pid) => nb + '/' + pid
const metaOf = (nb) => { const m = { ...nb }; delete m.thumb; return m }

/** Writes a whole notebook in the compact page format (used for new, copied and imported ones). */
async function writeDoc(nb, doc) {
  const old = await db.keysByIndex('pages', 'nb', nb.id).catch(() => [])
  const keep = new Set(doc.pages.map(p => pageKey(nb.id, p.id)))
  const ops = [['put', 'notebooks', metaOf(nb)], ['put', 'docs', { id: nb.id, v: 2, order: doc.pages.map(p => p.id) }]]
  for (const p of doc.pages) ops.push(['put', 'pages', { k: pageKey(nb.id, p.id), nb: nb.id, id: p.id, items: packItems(p.items) }])
  for (const k of old) if (!keep.has(k)) ops.push(['del', 'pages', k])
  await db.multi(ops)
  doc._saved = new Set(doc.pages.map(p => p.id))
}

/** Reads a notebook's pages; old (v1) notebooks are converted and rewritten compactly. */
export async function loadDoc(id) {
  const rec = await db.get('docs', id)
  if (rec && rec.v === 2) {
    const rows = await db.byIndex('pages', 'nb', id)
    const by = new Map(rows.map(r => [r.id, r]))
    const doc = { id, pages: rec.order.map(pid => ({ id: pid, items: unpackItems(by.get(pid)?.items) })) }
    doc._saved = new Set(rows.map(r => r.id))
    return { doc, old: false }
  }
  if (rec && rec.pages) return { doc: { id, pages: rec.pages.map(p => ({ id: p.id, items: unpackItems(p.items) })) }, old: true }
  return { doc: null, old: false }
}

export async function openDoc(id) {
  if (state.docs.has(id)) return state.docs.get(id)
  let { doc, old } = await loadDoc(id)
  if (!doc) { doc = newDoc(state.notebooks.get(id)); old = true }
  state.docs.set(id, doc)
  if (old && state.notebooks.has(id)) await writeDoc(state.notebooks.get(id), doc)
  return doc
}

export const pageSize = (nb) => (nb.type === 'canvas' ? null : A4[nb.orient] || A4.v)

// ---- saving

// What changed since the last save, per notebook: its details, its page order, which pages.
const pending = new Map()
let timer = 0, retryDelay = 1500

/** Marks a notebook as changed; it is written to this device within a moment.
 *  page: the id of the one page that changed. order: pages were added, removed or moved.
 *  meta: only the notebook's details (title, lining...). With none of these, every page is saved. */
export function touch(id, { meta = false, page = null, order = false } = {}) {
  const nb = state.notebooks.get(id)
  if (!nb) return
  if (!meta) nb.updated = Date.now()
  const doc = state.docs.get(id)
  if (doc) nb.pages = doc.pages.length
  let p = pending.get(id)
  if (!p) pending.set(id, (p = { pages: new Set(), order: false, all: false }))
  if (page) p.pages.add(page)
  if (order) p.order = true
  if (!meta && !page && !order) p.all = true
  emit('dirty', id)
  clearTimeout(timer)
  timer = setTimeout(flush, meta ? 50 : 350)
}

export const isDirty = () => pending.size > 0

export async function flush() {
  clearTimeout(timer)
  if (!pending.size || state.saving) return
  state.saving = true
  const batch = new Map(pending)
  pending.clear()
  const ops = []
  for (const [id, p] of batch) {
    const nb = state.notebooks.get(id)
    if (!nb) continue
    ops.push(['put', 'notebooks', metaOf(nb)])
    const doc = state.docs.get(id)
    if (!doc) continue
    const saved = doc._saved || new Set()
    const ids = doc.pages.map(pg => pg.id)
    const write = new Set(p.all ? ids : [...p.pages].filter(x => ids.includes(x)))
    if (p.order || p.all) {
      for (const pid of ids) if (!saved.has(pid)) write.add(pid)
      for (const pid of saved) if (!ids.includes(pid)) ops.push(['del', 'pages', pageKey(id, pid)])
      ops.push(['put', 'docs', { id, v: 2, order: ids }])
    }
    for (const pg of doc.pages) if (write.has(pg.id)) ops.push(['put', 'pages', { k: pageKey(id, pg.id), nb: id, id: pg.id, items: packItems(pg.items) }])
  }
  try {
    await db.multi(ops)
    for (const [id] of batch) { const doc = state.docs.get(id); if (doc) doc._saved = new Set(doc.pages.map(pg => pg.id)) }
    state.saveError = null
    retryDelay = 1500
    state.saving = false
    for (const [id] of batch) emit('saved', id)
    scheduleThumbs([...batch.keys()])
  } catch (err) {
    // Keep everything queued and try again; the in-memory copy is still the latest.
    for (const [id, p] of batch) {
      const cur = pending.get(id)
      if (!cur) pending.set(id, p)
      else { p.pages.forEach(x => cur.pages.add(x)); cur.order ||= p.order; cur.all ||= p.all }
    }
    state.saving = false
    state.saveError = String(err && err.message || err)
    emit('saveError', state.saveError)
    timer = setTimeout(flush, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 20000)
    return
  }
  if (pending.size) timer = setTimeout(flush, 120)
}

export async function updateNotebook(id, patch) {
  const nb = state.notebooks.get(id)
  Object.assign(nb, patch)
  touch(id, { meta: true })
  emit('notebooks')
}

export async function deleteForever(id) {
  state.notebooks.delete(id)
  state.docs.delete(id)
  const keys = await db.keysByIndex('pages', 'nb', id).catch(() => [])
  await db.multi([['del', 'notebooks', id], ['del', 'docs', id], ['del', 'thumbs', id], ...keys.map(k => ['del', 'pages', k])])
  dropThumbURL(id)
  emit('notebooks')
  emit('deleted', id)
}

export async function duplicateNotebook(id) {
  const src = state.notebooks.get(id)
  const doc = clean(await openDoc(id))
  const nb = { ...clean(src), id: uid(), title: src.title + ' copy', created: Date.now(), updated: Date.now(), base: {} }
  doc.id = nb.id
  state.notebooks.set(nb.id, nb)
  state.docs.set(nb.id, doc)
  await writeDoc(nb, doc)
  scheduleThumbs([nb.id])
  emit('notebooks')
  emit('saved', nb.id)
  return nb
}

/** Puts a notebook pulled from the cloud on this device. */
export async function importNotebook(nb, doc) {
  delete nb.thumb
  state.notebooks.set(nb.id, nb)
  state.docs.set(nb.id, doc)
  await writeDoc(nb, doc)
  scheduleThumbs([nb.id])
  emit('notebooks')
}

// ---- pictures

export async function addBlob(blob) {
  const id = uid()
  await db.put('blobs', { id, blob, type: blob.type, created: Date.now() })
  return id
}

export function blobIds(doc) {
  const s = new Set()
  for (const p of doc.pages) for (const it of p.items) if (it.t === 'i') s.add(it.blob)
  return [...s]
}

// ---- thumbnails for the library: small JPEGs in their own store, made a while after editing stops

const thumbQ = new Set()
let thumbT = 0
const thumbURLs = new Map()
function scheduleThumbs(ids) {
  ids.forEach(i => thumbQ.add(i))
  clearTimeout(thumbT)
  thumbT = setTimeout(runThumbs, 2500)
}
async function runThumbs() {
  for (const id of [...thumbQ]) {
    thumbQ.delete(id)
    const nb = state.notebooks.get(id)
    if (!nb) continue
    try {
      const doc = await openDoc(id)
      const c = renderThumb(nb, doc)
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72))
      await db.put('thumbs', { id, blob, at: nb.updated })
      dropThumbURL(id)
      emit('thumb', id)
    } catch { }
    await new Promise(r => setTimeout(r, 30))
  }
}
function dropThumbURL(id) { const u = thumbURLs.get(id); if (u) { URL.revokeObjectURL(u); thumbURLs.delete(id) } }
/** Object URL of a notebook's preview, or null. Made once and reused, so cards do not reload. */
export async function thumbURL(id) {
  if (thumbURLs.has(id)) return thumbURLs.get(id)
  const r = await db.get('thumbs', id).catch(() => null)
  if (!r) {
    // Older notebooks: make one now.
    const nb = state.notebooks.get(id)
    if (nb && !thumbQ.has(id)) scheduleThumbs([id])
    return null
  }
  const u = URL.createObjectURL(r.blob)
  thumbURLs.set(id, u)
  return u
}

export function renderThumb(nb, doc, W = 240) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  if (nb.type === 'canvas') {
    const items = doc.pages[0].items
    let b = [0, 0, 800, 600]
    if (items.length) {
      b = [Infinity, Infinity, -Infinity, -Infinity]
      for (const it of items) { const q = bbox(it); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] }
    }
    const H = Math.round(W * 0.75)
    const s = Math.min(W / Math.max(1, b[2] - b[0] + 60), H / Math.max(1, b[3] - b[1] + 60), 1.2)
    c.width = W; c.height = H
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2
    ctx.setTransform(s, 0, 0, s, W / 2 - cx * s, H / 2 - cy * s)
    const view = [cx - W / 2 / s, cy - H / 2 / s, cx + W / 2 / s, cy + H / 2 / s]
    ctx.fillStyle = (PAPERS[nb.paper] || PAPERS.white).bg
    ctx.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1])
    drawCanvasView(ctx, nb, doc.pages[0], view, s)
  } else {
    const size = pageSize(nb)
    const s = W / size[0] * (nb.orient === 'h' ? 1 : 0.62)
    c.width = Math.round(size[0] * s); c.height = Math.round(size[1] * s)
    ctx.setTransform(s, 0, 0, s, 0, 0)
    drawPage(ctx, nb, doc.pages[0], size, null, s)
  }
  return c
}

function drawCanvasView(ctx, nb, page, view, s) {
  drawLining(ctx, nb.lining, nb.paper, view, s, null)
  drawItems(ctx, page.items, view, nb.paper)
}

// ---- backups: one file with every notebook and picture

export async function exportBackup() {
  await flush()
  const [nbs, blobs] = await Promise.all([db.all('notebooks'), db.all('blobs')])
  const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s) }
  const out = { app: 'CocoaNotes', v: 2, at: new Date().toISOString(), subjects: state.subjects, notebooks: [], blobs: [] }
  for (const nb of nbs) {
    const { doc } = await loadDoc(nb.id)
    out.notebooks.push({ nb: metaOf(nb), pages: (doc ? doc.pages : []).map(p => ({ id: p.id, items: itemsToJSON(p.items) })) })
  }
  for (const b of blobs) out.blobs.push({ id: b.id, type: b.type || b.blob.type, data: await b64(b.blob) })
  return new Blob([JSON.stringify(out)], { type: 'application/json' })
}

/** Adds what a backup holds; never removes or replaces newer notes already here. */
export async function importBackup(file) {
  const data = JSON.parse(await file.text())
  if (data.app !== 'CocoaNotes') throw new Error('This is not a CocoaNotes backup')
  const ops = []
  for (const b of data.blobs || []) {
    const bin = atob(b.data), u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    ops.push(['put', 'blobs', { id: b.id, blob: new Blob([u], { type: b.type }), type: b.type, created: Date.now() }])
  }
  await db.multi(ops)
  // v2 files carry each notebook with its pages; v1 files had separate lists.
  const list = data.v === 2 ? data.notebooks.map(x => ({ nb: x.nb, doc: { id: x.nb.id, pages: x.pages.map(p => ({ id: p.id, items: itemsFromJSON(p.items) })) } }))
    : (data.notebooks || []).map(nb => { const d = (data.docs || []).find(x => x.id === nb.id); return { nb, doc: d ? { id: nb.id, pages: d.pages.map(p => ({ id: p.id, items: unpackItems(p.items) })) } : newDoc(nb) } })
  let added = 0
  for (const { nb, doc } of list) {
    const cur = state.notebooks.get(nb.id)
    if (cur && cur.updated >= nb.updated) continue
    delete nb.thumb
    state.notebooks.set(nb.id, nb)
    state.docs.set(nb.id, doc)
    await writeDoc(nb, doc)
    scheduleThumbs([nb.id])
    added++
  }
  for (const s of data.subjects || []) if (!state.subjects.some(x => x.id === s.id)) state.subjects.push(s)
  await saveSubjects()
  emit('notebooks')
  return added
}

/** How much space notes and pictures take on this device, in bytes. */
export async function usage() {
  const [pages, blobs, thumbs] = await Promise.all([db.all('pages'), db.all('blobs'), db.all('thumbs')])
  let ink = 0, pics = 0, prev = 0
  for (const p of pages) for (const it of p.items) { ink += 60; if (it.p) ink += it.p.byteLength; if (it.text) ink += it.text.length * 2 }
  for (const b of blobs) pics += b.blob.size
  for (const t of thumbs) prev += t.blob.size
  return { ink, pics, prev }
}

window.addEventListener('pagehide', () => { flush() })
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
