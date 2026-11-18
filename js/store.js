// Notebooks in memory, saved to this device as you write. A change is never dropped: if a save
// fails it stays queued and is tried again, and the cloud copy is only made from what was saved here.
import { db, uid, clean } from './db.js'
import { A4, drawPage, PAPERS, drawLining, drawItems } from './render.js'
import { bbox } from './ink.js'

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
  for (const nb of nbs) state.notebooks.set(nb.id, nb)
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
  await db.multi([['put', 'notebooks', nb], ['put', 'docs', clean(doc)]])
  emit('notebooks')
  emit('saved', nb.id)
  return nb
}

export async function openDoc(id) {
  if (state.docs.has(id)) return state.docs.get(id)
  let doc = await db.get('docs', id)
  if (!doc) doc = newDoc(state.notebooks.get(id))
  state.docs.set(id, doc)
  return doc
}

export const pageSize = (nb) => (nb.type === 'canvas' ? null : A4[nb.orient] || A4.v)

// ---- saving

const pending = new Set()
let timer = 0, retryDelay = 1500

/** Marks a notebook as changed; it is written to this device within a moment. */
export function touch(id, { meta = false } = {}) {
  const nb = state.notebooks.get(id)
  if (!nb) return
  nb.updated = Date.now()
  const doc = state.docs.get(id)
  if (doc) nb.pages = doc.pages.length
  pending.add(id)
  emit('dirty', id)
  clearTimeout(timer)
  timer = setTimeout(flush, meta ? 50 : 350)
}

export const isDirty = () => pending.size > 0

export async function flush() {
  clearTimeout(timer)
  if (!pending.size || state.saving) return
  state.saving = true
  const ids = [...pending]
  pending.clear()
  const ops = []
  for (const id of ids) {
    const nb = state.notebooks.get(id)
    if (!nb) continue
    ops.push(['put', 'notebooks', nb])
    const doc = state.docs.get(id)
    if (doc) ops.push(['put', 'docs', clean(doc)])
  }
  try {
    await db.multi(ops)
    state.saveError = null
    retryDelay = 1500
    state.saving = false
    for (const id of ids) emit('saved', id)
    scheduleThumbs(ids)
  } catch (err) {
    // Keep everything queued and try again; the in-memory copy is still the latest.
    for (const id of ids) pending.add(id)
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
  await db.multi([['del', 'notebooks', id], ['del', 'docs', id]])
  emit('notebooks')
  emit('deleted', id)
}

export async function duplicateNotebook(id) {
  const src = state.notebooks.get(id)
  const doc = clean(await openDoc(id))
  const nb = { ...clean(src), id: uid(), title: src.title + ' copy', created: Date.now(), updated: Date.now(), base: {}, thumb: src.thumb }
  doc.id = nb.id
  state.notebooks.set(nb.id, nb)
  state.docs.set(nb.id, doc)
  await db.multi([['put', 'notebooks', nb], ['put', 'docs', doc]])
  emit('notebooks')
  emit('saved', nb.id)
  return nb
}

/** Puts a notebook pulled from the cloud on this device. */
export async function importNotebook(nb, doc) {
  state.notebooks.set(nb.id, nb)
  state.docs.set(nb.id, doc)
  await db.multi([['put', 'notebooks', nb], ['put', 'docs', doc]])
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

// ---- thumbnails for the library

const thumbQ = new Set()
let thumbT = 0
function scheduleThumbs(ids) {
  ids.forEach(i => thumbQ.add(i))
  clearTimeout(thumbT)
  thumbT = setTimeout(runThumbs, 900)
}
async function runThumbs() {
  for (const id of [...thumbQ]) {
    thumbQ.delete(id)
    const nb = state.notebooks.get(id)
    if (!nb) continue
    try {
      const doc = await openDoc(id)
      nb.thumb = renderThumb(nb, doc)
      await db.put('notebooks', nb)
      emit('thumb', id)
    } catch { }
    await new Promise(r => setTimeout(r, 30))
  }
}

export function renderThumb(nb, doc, W = 360) {
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
  return c.toDataURL('image/jpeg', 0.82)
}

function drawCanvasView(ctx, nb, page, view, s) {
  drawLining(ctx, nb.lining, nb.paper, view, s, null)
  drawItems(ctx, page.items, view, nb.paper)
}

// ---- backups: one file with every notebook and picture

export async function exportBackup() {
  await flush()
  const [nbs, docs, blobs] = await Promise.all([db.all('notebooks'), db.all('docs'), db.all('blobs')])
  const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s) }
  const out = { app: 'CocoaNotes', v: 1, at: new Date().toISOString(), subjects: state.subjects, notebooks: nbs, docs, blobs: [] }
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
  const docs = new Map((data.docs || []).map(d => [d.id, d]))
  let added = 0
  for (const nb of data.notebooks || []) {
    const cur = state.notebooks.get(nb.id)
    if (cur && cur.updated >= nb.updated) continue
    ops.push(['put', 'notebooks', nb])
    if (docs.has(nb.id)) ops.push(['put', 'docs', docs.get(nb.id)])
    state.notebooks.set(nb.id, nb)
    state.docs.delete(nb.id)
    added++
  }
  for (const s of data.subjects || []) if (!state.subjects.some(x => x.id === s.id)) state.subjects.push(s)
  await db.multi(ops)
  await saveSubjects()
  emit('notebooks')
  return added
}

window.addEventListener('pagehide', () => { flush() })
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
