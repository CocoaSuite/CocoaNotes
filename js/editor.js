// The writing surface: journals (A4 pages) and endless canvases.
// Ink is captured from every coalesced pointer sample, drawn live on a low-latency layer and
// committed as vector outlines; the page layer redraws from those outlines at any zoom.
import { h, $, icon, iconBtn, toast, popover, closePop, popOpenFor, menu, confirmSheet, promptSheet, download, penSVG } from './ui.js'
import { PENS, PEN_ORDER, sampleFactor, bbox, strokePath, maybeStraighten, hitStroke, inLasso, shapePoints, arrowHead, moveItem, scaleItem, invalidate, path2d } from './ink.js'
import { GAP, PAPERS, LININGS_J, LININGS_C, FONTS, drawPage, drawLining, drawItems, drawStroke, layoutText, setImageListener, pageSVG, inkFor, fontOf } from './render.js'
import { state, settings, saveSettings, openDoc, touch, flush, pageSize, addBlob, updateNotebook, on as onStore } from './store.js'
import { uid, clean } from './db.js'
import { syncChip } from './status.js'
import * as fx from './fx.js'
import { initCase, caseSync } from './tactile.js'

const ACCENT = '#F5913E'
const COLORS = ['#23324d', '#1c1c1c', '#c0562a', '#2f7d55', '#2f5fd0', '#7a3f8f', '#8a8a8a', '#F5913E', '#d1343a', '#0f8a8a', '#ffd54a', '#7cd38a']
const HIGH_COLORS = ['#ffd54a', '#7cd38a', '#7fc8ff', '#ff9ec2', '#ffb070', '#c6a8ff']

let nb = null, doc = null, size = null
let el = {}
let ctx, ictx, dpr = 1, W = 0, H = 0
const view = { s: 1, x: 0, y: 0 }
let tool = 'pen'          // pen | eraser | lasso | shape | text
let pen = 'ball'
let need = 0, needInk = false, lastRenderMs = 0
let undoStack = [], redoStack = []
let sel = null            // { pi, ids:Set }
let editing = null        // { pi, item, ta, isNew, before }
let clip = null
let curPage = 0
let snap = null

const penCfg = (p = pen) => {
  settings.pens = settings.pens || {}
  if (!settings.pens[p]) settings.pens[p] = { w: PENS[p].w, c: p === 'high' ? '#ffd54a' : settings.color || '#23324d' }
  return settings.pens[p]
}

// ------------------------------------------------------------- layout

const isJ = () => nb && nb.type !== 'canvas'
const pageTop = (i) => i * (size[1] + GAP)
const totalH = () => doc.pages.length * (size[1] + GAP) - GAP
const minS = () => (isJ() ? 0.15 : 0.05), maxS = () => (isJ() ? 10 : 30)

function toWorld(sx, sy) { return [(sx - view.x) / view.s, (sy - view.y) / view.s] }
/** Page index and page-local point for a screen point. */
function locate(sx, sy) {
  const [wx, wy] = toWorld(sx, sy)
  if (!isJ()) return { pi: 0, x: wx, y: wy }
  let pi = Math.floor((wy + GAP / 2) / (size[1] + GAP))
  pi = Math.max(0, Math.min(doc.pages.length - 1, pi))
  return { pi, x: wx, y: wy - pageTop(pi) }
}
const pageOrigin = (pi) => (isJ() ? [view.x, view.y + pageTop(pi) * view.s] : [view.x, view.y])
const toScreen = (pi, x, y) => { const o = pageOrigin(pi); return [o[0] + x * view.s, o[1] + y * view.s] }

function fit(pi = curPage) {
  if (isJ()) {
    const pad = W < 720 ? 12 : 40
    view.s = Math.min((W - pad * 2) / size[0], nb.orient === 'h' ? (H - 120) / size[1] : 1.6)
    view.s = Math.max(view.s, 0.3)
    view.x = (W - size[0] * view.s) / 2
    view.y = 18 - pageTop(pi) * view.s
  } else {
    const items = doc.pages[0].items
    if (items.length) {
      let b = [Infinity, Infinity, -Infinity, -Infinity]
      for (const it of items) { const q = bbox(it); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] }
      view.s = Math.max(0.1, Math.min(1.5, (W - 120) / (b[2] - b[0] + 1), (H - 160) / (b[3] - b[1] + 1)))
      view.x = W / 2 - ((b[0] + b[2]) / 2) * view.s
      view.y = H / 2 - ((b[1] + b[3]) / 2) * view.s
    } else { view.s = 1; view.x = W / 2; view.y = H / 2 }
  }
  clampView()
}

function clampView() {
  view.s = Math.max(minS(), Math.min(maxS(), view.s))
  if (!isJ()) return
  const pw = size[0] * view.s
  if (pw <= W) { const c = (W - pw) / 2; view.x = Math.max(c - W * 0.35, Math.min(c + W * 0.35, view.x)) }
  else view.x = Math.max(W - pw - W * 0.3, Math.min(W * 0.3, view.x))
  const th = totalH() * view.s
  view.y = Math.max(H * 0.45 - th, Math.min(H * 0.45, view.y))
}

/** While a finger is down the view may go past its limits, with resistance, so it never
 *  fights the hand; on release it eases back. */
function softClamp() {
  const want = { ...view }
  clampView()
  const tx = view.x, ty = view.y
  view.x = want.x + (tx - want.x) * 0.6
  view.y = want.y + (ty - want.y) * 0.6
  view.s = want.s
}
function settle() {
  cancelInertia()
  const from = { ...view }
  // Zoom back inside the limits around the middle of the screen, then fit the position.
  const s = Math.max(minS(), Math.min(maxS(), view.s))
  const cx = W / 2, cy = H / 2, wx = (cx - view.x) / view.s, wy = (cy - view.y) / view.s
  view.s = s; view.x = cx - wx * s; view.y = cy - wy * s
  clampView()
  const to = { ...view }
  Object.assign(view, from)
  if (Math.abs(to.s - from.s) < 1e-4 && Math.abs(to.x - from.x) < 0.5 && Math.abs(to.y - from.y) < 0.5) { Object.assign(view, to); updatePageInfo(); return }
  const t0 = performance.now()
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 280), e = 1 - Math.pow(1 - k, 3)
    view.s = from.s + (to.s - from.s) * e; view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e
    render(); placeChrome()
    if (k < 1) inertia = requestAnimationFrame(step); else { inertia = 0; updatePageInfo() }
  }
  inertia = requestAnimationFrame(step)
}

// ------------------------------------------------------------- render

export function requestRender(full = true) {
  if (full) need = 2
  else if (!need) need = 1
  schedule()
}
function requestInk() { needInk = true; schedule() }
let raf = 0
function schedule() { if (!raf) raf = requestAnimationFrame(frame) }
function frame() {
  raf = 0
  if (!nb) return
  if (need) { const t = performance.now(); render(); lastRenderMs = performance.now() - t; need = 0; placeChrome() }
  if (needInk) { renderInk(); needInk = false }
}

function viewRect() { return [-view.x / view.s, -view.y / view.s, (W - view.x) / view.s, (H - view.y) / view.s] }

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const paper = PAPERS[nb.paper] || PAPERS.white
  const skip = editing ? new Set([editing.item.id]) : null
  if (isJ()) {
    ctx.fillStyle = '#1f1f1f'
    ctx.fillRect(0, 0, W, H)
    const [, vy0, , vy1] = viewRect()
    for (let i = 0; i < doc.pages.length; i++) {
      const t = pageTop(i)
      if (t + size[1] < vy0 || t > vy1) continue
      const ox = view.x, oy = view.y + t * view.s
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = 'rgba(0,0,0,.35)'
      ctx.fillRect(ox + 2, oy + 4, size[0] * view.s, size[1] * view.s)
      ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * ox, dpr * oy)
      const vr = viewRect()
      drawPage(ctx, nb, doc.pages[i], size, [vr[0], vr[1] - t, vr[2], vr[3] - t], view.s, skip)
    }
  } else {
    ctx.fillStyle = paper.bg
    ctx.fillRect(0, 0, W, H)
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y)
    const vr = viewRect()
    drawLining(ctx, nb.lining, nb.paper, vr, view.s, null)
    drawItems(ctx, doc.pages[0].items, vr, nb.paper, skip)
  }
}


/** Draws one finished item straight onto the page layer, without a full redraw. */
function paintItem(pi, it) {
  const o = pageOrigin(pi)
  ctx.save()
  ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * o[0], dpr * o[1])
  if (isJ()) { ctx.beginPath(); ctx.rect(0, 0, size[0], size[1]); ctx.clip() }
  if (it.t === 's') drawStroke(ctx, it, nb.paper)
  ctx.restore()
}

// live layer: the stroke being written, lasso, shape preview, hover nib
let live = null, lasso = null, shapeLive = null, hover = null
function renderInk() {
  ictx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ictx.clearRect(0, 0, W, H)
  if (live) {
    const o = pageOrigin(live.pi)
    ictx.save()
    ictx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * o[0], dpr * o[1])
    if (isJ()) { ictx.beginPath(); ictx.rect(0, 0, size[0], size[1]); ictx.clip() }
    const tmp = { ...live.item, pts: live.pred ? live.item.pts.concat(live.pred) : live.item.pts }
    invalidate(tmp)
    ictx.fillStyle = live.item.pen === 'high' ? live.item.c : inkFor(live.item.c, nb.paper)
    ictx.globalAlpha = live.item.pen === 'high' ? 0.42 : live.item.pen === 'pencil' ? 0.82 : 1
    ictx.fill(new Path2D(strokePath(tmp)))
    ictx.restore()
  }
  if (shapeLive) {
    const o = pageOrigin(shapeLive.pi)
    ictx.save()
    ictx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * o[0], dpr * o[1])
    ictx.fillStyle = inkFor(shapeLive.c, nb.paper)
    for (const it of shapeLive.items) ictx.fill(new Path2D(strokePath(it)))
    ictx.restore()
  }
  if (lasso) {
    const o = pageOrigin(lasso.pi)
    ictx.save()
    ictx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * o[0], dpr * o[1])
    ictx.beginPath()
    for (let i = 0; i < lasso.poly.length; i += 2) i ? ictx.lineTo(lasso.poly[i], lasso.poly[i + 1]) : ictx.moveTo(lasso.poly[0], lasso.poly[1])
    ictx.closePath()
    ictx.fillStyle = 'rgba(245,145,62,.08)'; ictx.fill()
    ictx.setLineDash([6 / view.s, 5 / view.s]); ictx.lineWidth = 1.6 / view.s; ictx.strokeStyle = ACCENT; ictx.stroke()
    ictx.restore()
  }
  if (hover && settings.hover) {
    const r = Math.max(2, (tool === 'eraser' ? eraserR() : penCfg().w / 2) * view.s)
    ictx.beginPath(); ictx.arc(hover[0], hover[1], r, 0, Math.PI * 2)
    ictx.lineWidth = 1.2; ictx.strokeStyle = 'rgba(128,128,128,.9)'; ictx.stroke()
    if (tool === 'pen') { ictx.fillStyle = penCfg().c; ictx.globalAlpha = 0.35; ictx.fill(); ictx.globalAlpha = 1 }
  }
}
const eraserR = () => settings.eraserR || 10

// ------------------------------------------------------------- undo

function snapItems(pi, ids) {
  const items = doc.pages[pi].items
  const out = []
  items.forEach((it, i) => { if (ids.has(it.id)) out.push({ it: clean(it), i }) })
  return out
}
function commit(entry) {
  undoStack.push(entry)
  if (undoStack.length > 300) undoStack.shift()
  redoStack = []
  touch(nb.id, { page: doc.pages[entry.pi]?.id })
  markThumb(entry.pi)
  updateUndo()
}
function applyItems(pi, remove, add) {
  const items = doc.pages[pi].items
  const rm = new Set(remove.map(x => x.it.id))
  for (let i = items.length - 1; i >= 0; i--) if (rm.has(items[i].id)) items.splice(i, 1)
  for (const x of [...add].sort((a, b) => a.i - b.i)) items.splice(Math.min(x.i, items.length), 0, clean(x.it))
}
function undo() {
  finishText()
  const e = undoStack.pop()
  if (!e) return
  if (e.kind === 'pages') { doc.pages = e.before.slice(); afterPages() }
  else applyItems(e.pi, e.after, e.before)
  redoStack.push(e)
  clearSel(); touch(nb.id, e.kind === 'pages' ? { order: true } : { page: doc.pages[e.pi]?.id }); markThumb(e.pi); requestRender(); updateUndo()
}
function redo() {
  finishText()
  const e = redoStack.pop()
  if (!e) return
  if (e.kind === 'pages') { doc.pages = e.after.slice(); afterPages() }
  else applyItems(e.pi, e.before, e.after)
  undoStack.push(e)
  clearSel(); touch(nb.id, e.kind === 'pages' ? { order: true } : { page: doc.pages[e.pi]?.id }); markThumb(e.pi); requestRender(); updateUndo()
}
function updateUndo() {
  el.undo.disabled = !undoStack.length
  el.redo.disabled = !redoStack.length
}

function addItems(pi, items) {
  const page = doc.pages[pi].items
  const after = items.map(it => { page.push(it); return { it: clean(it), i: page.length - 1 } })
  commit({ pi, before: [], after })
}
function removeIds(pi, ids) {
  const before = snapItems(pi, ids)
  if (!before.length) return
  applyItems(pi, before, [])
  commit({ pi, before, after: [] })
}

// ------------------------------------------------------------- input

const pointers = new Map()
let penSeen = false, penDown = false
let action = null   // { kind, id, ... }
let gesture = null
let spaceDown = false
let inertia = 0

const penOnly = () => settings.penOnly === true || (settings.penOnly === 'auto' && penSeen)

function onDown(e) {
  if (e.button === 2) return
  closePop()
  cancelInertia()
  const r = el.surface.getBoundingClientRect()
  const p = { id: e.pointerId, type: e.pointerType, x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }
  p.sx = p.x; p.sy = p.y
  if (e.pointerType === 'pen') { penSeen = true; penDown = true; hover = null }
  if (e.pointerType === 'touch') {
    // Palm rejection: ignore touches while the pen is writing, and big contact areas once a pen was used.
    if (settings.palm && (penDown || (penSeen && (e.width > 44 || e.height > 44)))) return
  }
  el.surface.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, p)
  e.preventDefault()

  const touches = [...pointers.values()].filter(q => q.type === 'touch')
  if (e.pointerType === 'touch' && (penOnly() || touches.length >= 2 || (action && action.kind === 'gesture'))) {
    // A second finger turns a just-started finger stroke into a pinch.
    if (action && action.pid !== undefined && pointers.get(action.pid)?.type === 'touch') {
      if (performance.now() - action.t0 < 250) cancelAction()
      else return
    }
    startGesture(touches)
    return
  }
  if (gesture) return
  if (e.pointerType === 'mouse' && (e.button === 1 || spaceDown)) { startPan(p); return }
  if (tool === 'text' && editing && el.textBox.contains(e.target)) return
  startTool(p, e)
}

function onMove(e) {
  const r = el.surface.getBoundingClientRect()
  if (e.pointerType === 'pen' && !pointers.has(e.pointerId)) {
    // Hover preview while the nib is above the screen.
    if (e.buttons === 0 && settings.hover) { hover = [e.clientX - r.left, e.clientY - r.top]; requestInk() }
    return
  }
  const p = pointers.get(e.pointerId)
  if (!p) return
  e.preventDefault()
  p.x = e.clientX - r.left; p.y = e.clientY - r.top
  if (gesture) { moveGesture(); return }
  if (!action || action.pid !== e.pointerId) return
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null
  const list = evs && evs.length ? evs : [e]
  for (const ce of list) moveTool(ce.clientX - r.left, ce.clientY - r.top, ce)
  if (action && action.kind === 'stroke' && e.getPredictedEvents) {
    const pr = e.getPredictedEvents()
    live.pred = []
    for (const pe of pr.slice(0, 2)) { const [wx, wy] = toWorld(pe.clientX - r.left, pe.clientY - r.top); live.pred.push(r2(wx), r2(isJ() ? wy - pageTop(action.pi) : wy), live.item.pts[live.item.pts.length - 1]) }
  }
  requestInk()
}

function onUp(e) {
  const p = pointers.get(e.pointerId)
  if (e.pointerType === 'pen') penDown = false
  if (!p) return
  pointers.delete(e.pointerId)
  if (gesture) { endGesture(e.type === 'pointercancel'); return }
  if (action && action.pid === e.pointerId) endTool(e.type === 'pointercancel')
}

// ---- gestures: pan, pinch, two- and three-finger taps

function startGesture(touches) {
  if (gesture) {
    gesture.max = Math.max(gesture.max, touches.length)
    resetGesture(touches)
    return
  }
  gesture = { t0: performance.now(), max: touches.length, moved: 0, vel: [0, 0], last: null }
  resetGesture(touches)
}
function resetGesture(touches) {
  const pts = touches.length ? touches : [...pointers.values()]
  const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length
  const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
  Object.assign(gesture, { mx, my, d, s0: view.s, x0: view.x, y0: view.y, n: pts.length, last: [mx, my, performance.now()] })
}
function moveGesture() {
  const pts = [...pointers.values()].filter(q => q.type === 'touch')
  if (!pts.length) return
  if (pts.length !== gesture.n) { resetGesture(pts); return }
  const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length, my = pts.reduce((a, q) => a + q.y, 0) / pts.length
  let s = gesture.s0
  if (pts.length > 1 && gesture.d > 0) s = gesture.s0 * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / gesture.d
  // Past the zoom limits the pinch resists a little instead of stopping dead.
  const lo = minS(), hi = maxS()
  if (s < lo) s = lo * Math.pow(s / lo, 0.25)
  if (s > hi) s = hi * Math.pow(s / hi, 0.25)
  const wx = (gesture.mx - gesture.x0) / gesture.s0, wy = (gesture.my - gesture.y0) / gesture.s0
  view.s = s; view.x = mx - wx * s; view.y = my - wy * s
  softClamp()
  gesture.moved = Math.max(gesture.moved, Math.hypot(mx - gesture.mx, my - gesture.my), Math.abs(s - gesture.s0) * 200)
  const now = performance.now(), L = gesture.last
  if (L && now > L[2]) gesture.vel = [(mx - L[0]) / (now - L[2]), (my - L[1]) / (now - L[2])]
  gesture.last = [mx, my, now]
  requestRender()
}
function endGesture(cancel) {
  const left = [...pointers.values()].filter(q => q.type === 'touch')
  if (left.length) { resetGesture(left); return }
  const g = gesture
  gesture = null
  const quick = performance.now() - g.t0 < 320 && g.moved < 14
  if (!cancel && quick && settings.twoFingerUndo && g.max === 2) { undo(); toast('Undo') }
  else if (!cancel && quick && settings.twoFingerUndo && g.max === 3) { redo(); toast('Redo') }
  else if (g.max === 1 || g.n === 1) { startInertia(g.vel); return }
  settle()
  requestRender()
  updatePageInfo()
}
function startInertia([vx, vy]) {
  if (Math.hypot(vx, vy) < 0.15) return
  let last = performance.now()
  const step = (t) => {
    const dt = Math.min(32, t - last); last = t
    view.x += vx * dt; view.y += vy * dt
    vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16)
    softClamp(); render(); placeChrome()
    if (Math.hypot(vx, vy) > 0.02) inertia = requestAnimationFrame(step)
    else { inertia = 0; settle() }
  }
  inertia = requestAnimationFrame(step)
}
function cancelInertia() { if (inertia) cancelAnimationFrame(inertia); inertia = 0 }

function startPan(p) { action = { kind: 'pan', pid: p.id, x0: view.x, y0: view.y, sx: p.x, sy: p.y, t0: performance.now() } }

// ---- tools

function startTool(p, e) {
  const L = locate(p.x, p.y)
  const t0 = performance.now()
  // A pen's side button (eraser end on many styluses) erases while held.
  const eraseBtn = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32))
  const t = eraseBtn ? 'eraser' : tool
  if (sel && (t === 'lasso' || sel.fresh) && inSelBox(p.x, p.y)) { startMove(p, L); return }
  if (t !== 'lasso' && sel) clearSel()
  if (t === 'pen') {
    const cfg = penCfg()
    const f = settings.pressure === false ? 1 : sampleFactor(pen, e, 0)
    const item = { id: uid(), t: 's', pen, c: cfg.c, w: cfg.w, pts: [r2(L.x), r2(L.y), r2(f)] }
    if (pen === 'calli') item.nib = settings.nib ?? 40
    live = { pi: L.pi, item, pred: null, raw: [L.x, L.y] }
    action = { kind: 'stroke', pid: p.id, pi: L.pi, t0, lt: performance.now() }
    fx.writeStart(pen)
    requestInk()
  } else if (t === 'eraser') {
    action = { kind: 'erase', pid: p.id, pi: L.pi, t0, removed: [], temp: eraseBtn }
    eraseAt(L.pi, L.x, L.y)
  } else if (t === 'lasso') {
    if (sel) clearSel()
    lasso = { pi: L.pi, poly: [L.x, L.y] }
    action = { kind: 'lasso', pid: p.id, pi: L.pi, t0, sx: p.x, sy: p.y }
  } else if (t === 'shape') {
    shapeLive = { pi: L.pi, a: [L.x, L.y], c: penCfg('ball').c, items: [] }
    action = { kind: 'shape', pid: p.id, pi: L.pi, t0 }
  } else if (t === 'text') {
    action = { kind: 'text', pid: p.id, pi: L.pi, t0, x: L.x, y: L.y, sx: p.x, sy: p.y }
  }
}

const r2 = (n) => Math.round(n * 100) / 100

function moveTool(sx, sy, e) {
  const a = action
  if (a.kind === 'pan') {
    view.x = a.x0 + sx - a.sx; view.y = a.y0 + sy - a.sy; clampView(); requestRender(); return
  }
  const [wx, wy] = toWorld(sx, sy)
  const x = wx, y = isJ() ? wy - pageTop(a.pi) : wy
  if (a.kind === 'stroke') {
    const P = live.item.pts
    const lx = P[P.length - 3], ly = P[P.length - 2]
    const dist = Math.hypot(x - lx, y - ly)
    if (dist < 0.6 / view.s) return
    // Light smoothing: steadier lines without the nib lagging behind.
    const k = 1 - PENS[pen].smooth * 0.3
    const nx = lx + (x - lx) * k, ny = ly + (y - ly) * k
    const f = settings.pressure === false ? 1 : sampleFactor(pen, e, dist * view.s)
    P.push(r2(nx), r2(ny), r2(f))
    const now = e.timeStamp || performance.now()
    fx.writeMove(dist * view.s / Math.max(1, now - (a.lt || now - 8)), e.pointerType === 'pen' ? e.pressure : 0.5)
    a.lt = now
  } else if (a.kind === 'erase') eraseAt(a.pi, x, y)
  else if (a.kind === 'lasso') { lasso.poly.push(r2(x), r2(y)) }
  else if (a.kind === 'shape') {
    const kind = settings.shape || 'line', [ax, ay] = shapeLive.a
    let bx = x, by = y
    if (kind === 'line' || kind === 'arrow') {
      // Snap to 15 degree steps when close.
      const ang = Math.atan2(by - ay, bx - ax), st = Math.PI / 12, sn = Math.round(ang / st) * st
      if (Math.abs(ang - sn) < 0.05) { const L = Math.hypot(bx - ax, by - ay); bx = ax + L * Math.cos(sn); by = ay + L * Math.sin(sn) }
    }
    const w = penCfg('ball').w * 1.2
    const lists = shapePoints(kind, ax, ay, bx, by)
    if (kind === 'arrow') lists.push(...arrowHead(ax, ay, bx, by, w))
    shapeLive.items = lists.map(pts => ({ id: uid(), t: 's', pen: 'marker', c: shapeLive.c, w, pts, shape: 1 }))
  } else if (a.kind === 'move') {
    const dx = x - a.lx, dy = y - a.ly
    a.lx = x; a.ly = y
    for (const it of doc.pages[a.pi].items) if (sel.ids.has(it.id)) moveItem(it, dx, dy)
    requestRender(); placeSel()
  } else if (a.kind === 'scale') {
    const [ox, oy] = a.origin
    const d0 = Math.hypot(a.sx - ox, a.sy - oy), d1 = Math.hypot(x - ox, y - oy)
    const k = Math.max(0.05, d1 / Math.max(1, d0))
    const step = k / a.k
    a.k = k
    for (const it of doc.pages[a.pi].items) if (sel.ids.has(it.id)) scaleItem(it, ox, oy, step)
    requestRender(); placeSel()
  } else if (a.kind === 'text') {
    if (Math.hypot(sx - a.sx, sy - a.sy) > 12) a.dragged = true
  }
}

function endTool(cancel) {
  const a = action
  action = null
  if (!a) return
  if (a.kind === 'pan') { updatePageInfo(); return }
  if (a.kind === 'stroke') {
    fx.writeEnd()
    const it = live.item
    live = null
    if (cancel) { requestInk(); return }
    maybeStraighten(it)
    if (it.pen === 'pencil') it.a = 0.82
    doc.pages[a.pi].items.push(it)
    const page = doc.pages[a.pi].items
    commit({ pi: a.pi, before: [], after: [{ it: clean(it), i: page.length - 1 }] })
    if (it.pen === 'high') requestRender(); else paintItem(a.pi, it)
    requestInk()
  } else if (a.kind === 'erase') {
    if (a.removed.length) {
      commit({ pi: a.pi, before: a.removed, after: [] })
    }
  } else if (a.kind === 'lasso') {
    const poly = lasso.poly
    lasso = null
    requestInk()
    if (poly.length < 6) {
      // A tap with the lasso picks the text or picture under it.
      const hit = hitBox(a.pi, poly[0], poly[1])
      if (hit) select(a.pi, [hit.id])
      return
    }
    const ids = doc.pages[a.pi].items.filter(it => inLasso(it, poly)).map(it => it.id)
    if (ids.length) select(a.pi, ids)
  } else if (a.kind === 'shape') {
    const items = shapeLive.items
    shapeLive = null
    requestInk()
    if (!cancel && items.length && strokeLen(items) > 4) { for (const it of items) it.pen = 'marker'; addItems(a.pi, items); requestRender() }
  } else if (a.kind === 'move' || a.kind === 'scale') {
    const after = snapItems(a.pi, sel.ids)
    if (JSON.stringify(after) !== JSON.stringify(a.before)) commit({ pi: a.pi, before: a.before, after })
    placeSel()
  } else if (a.kind === 'text') {
    if (cancel || a.dragged) return
    const hit = doc.pages[a.pi].items.find(it => it.t === 't' && a.x >= it.x - 6 && a.x <= it.x + it.w + 6 && a.y >= it.y - 6 && a.y <= it.y + it.h + 6)
    if (editing) { finishText(); return }
    if (hit) editText(a.pi, hit)
    else newText(a.pi, a.x, a.y)
  }
}

function strokeLen(items) { let s = 0; for (const it of items) { const P = it.pts; for (let i = 3; i < P.length; i += 3) s += Math.hypot(P[i] - P[i - 3], P[i + 1] - P[i - 2]) } return s }

function cancelAction() {
  if (!action) return
  if (action.kind === 'stroke') { live = null; fx.writeEnd() }
  if (action.kind === 'lasso') lasso = null
  if (action.kind === 'shape') shapeLive = null
  action = null
  requestInk()
}

function eraseAt(pi, x, y) {
  const r = eraserR() / Math.max(0.5, view.s) * 1.2
  const items = doc.pages[pi].items
  let hit = false
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.t !== 's') continue
    if (hitStroke(it, x, y, r)) { action.removed.push({ it: clean(it), i }); items.splice(i, 1); hit = true }
  }
  if (hit) requestRender()
}

function hitBox(pi, x, y) {
  const items = doc.pages[pi].items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.t === 's') { if (hitStroke(it, x, y, 6 / view.s)) return it; continue }
    if (it.t === 't') layoutText(it)
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it
  }
  return null
}

// ---- selection

function select(pi, ids, fresh = false) {
  sel = { pi, ids: new Set(ids), fresh }
  placeSel()
}
function clearSel() { sel = null; el.sel.hidden = true; el.selBar.hidden = true }
function selBounds() {
  let b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const it of doc.pages[sel.pi].items) if (sel.ids.has(it.id)) {
    if (it.t === 't') layoutText(it)
    const q = it.t === 's' ? bbox(it).map((v, i) => v + (i < 2 ? it.w * 2.5 : -it.w * 2.5)) : bbox(it)
    b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]
  }
  return b
}
function placeSel() {
  if (!sel) return
  const present = doc.pages[sel.pi]?.items.some(it => sel.ids.has(it.id))
  if (!present) { clearSel(); return }
  const b = selBounds()
  const [x0, y0] = toScreen(sel.pi, b[0], b[1]), [x1, y1] = toScreen(sel.pi, b[2], b[3])
  const pad = 8
  Object.assign(el.sel.style, { left: x0 - pad + 'px', top: y0 - pad + 'px', width: x1 - x0 + pad * 2 + 'px', height: y1 - y0 + pad * 2 + 'px' })
  el.sel.hidden = false
  el.selBar.hidden = false
  const bw = el.selBar.offsetWidth || 300
  let bx = (x0 + x1) / 2 - bw / 2, by = y0 - pad - 58
  if (by < 8) by = y1 + pad + 12
  el.selBar.style.left = Math.max(8, Math.min(W - bw - 8, bx)) + 'px'
  const floor = H - (settings.tray === 'bottom' || !settings.tray ? 160 : 70)
  el.selBar.style.top = Math.max(8, Math.min(floor, by)) + 'px'
  const single = sel.ids.size === 1 ? doc.pages[sel.pi].items.find(it => sel.ids.has(it.id)) : null
  el.selEdit.hidden = !(single && single.t === 't')
}
function inSelBox(sx, sy) {
  if (!sel || el.sel.hidden) return false
  const r = el.sel.getBoundingClientRect(), s = el.surface.getBoundingClientRect()
  return sx >= r.left - s.left && sx <= r.right - s.left && sy >= r.top - s.top && sy <= r.bottom - s.top
}
function startMove(p, L) {
  action = { kind: 'move', pid: p.id, pi: sel.pi, lx: L.x, ly: L.y, before: snapItems(sel.pi, sel.ids), t0: performance.now() }
  sel.fresh = false
}
function startScale(e) {
  e.stopPropagation(); e.preventDefault()
  const r = el.surface.getBoundingClientRect()
  const sx = e.clientX - r.left, sy = e.clientY - r.top
  el.surface.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: sx, y: sy })
  const b = selBounds()
  const L = locate(sx, sy)
  action = { kind: 'scale', pid: e.pointerId, pi: sel.pi, origin: [b[0], b[1]], sx: L.x, sy: L.y, k: 1, before: snapItems(sel.pi, sel.ids), t0: performance.now() }
}

function deleteSel() { if (!sel) return; const { pi, ids } = sel; clearSel(); removeIds(pi, ids); requestRender() }
function copySel(cut = false) {
  if (!sel) return
  const items = doc.pages[sel.pi].items.filter(it => sel.ids.has(it.id)).map(clean)
  clip = { items, from: nb.id }
  try { navigator.clipboard?.writeText(items.filter(i => i.t === 't').map(i => i.text).join('\n\n') || ' ') } catch { }
  if (cut) deleteSel(); else toast(items.length === 1 ? 'Copied' : `Copied ${items.length} items`)
}
function pasteClip() {
  if (!clip) return false
  const pi = curPage
  const items = clip.items.map(it => ({ ...clean(it), id: uid() }))
  for (const it of items) moveItem(it, 24, 24)
  addItems(isJ() ? pi : 0, items)
  clip.items = items.map(clean)
  setTool('lasso')
  select(isJ() ? pi : 0, items.map(i => i.id), true)
  requestRender()
  return true
}
function duplicateSel() { if (!sel) return; copySel(); pasteClip() }
function recolorSel(color) {
  if (!sel) return
  const before = snapItems(sel.pi, sel.ids)
  for (const it of doc.pages[sel.pi].items) if (sel.ids.has(it.id) && (it.t === 's' || it.t === 't')) { it.c = color; invalidate(it) }
  commit({ pi: sel.pi, before, after: snapItems(sel.pi, sel.ids) })
  requestRender()
}

// ------------------------------------------------------------- text

function newText(pi, x, y) {
  const s = settings.textSize || 22
  const maxW = isJ() ? Math.max(120, size[0] - x - 40) : 520
  const it = { id: uid(), t: 't', x: r2(x), y: r2(y - s * 0.7), w: Math.min(440, maxW), h: s * 1.35, s, f: settings.textFont || 'sans', b: false, c: penCfg('ball').c, text: '' }
  editText(pi, it, true)
}
function editText(pi, it, isNew = false) {
  finishText()
  clearSel()
  setTool('text', true)
  const before = isNew ? [] : snapItems(pi, new Set([it.id]))
  editing = { pi, item: it, isNew, before }
  const ta = el.textArea
  ta.value = it.text
  styleTextBox()
  el.textBox.hidden = false
  el.textBar.hidden = false
  syncTextBar()
  requestRender()
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }, 0)
}
function styleTextBox() {
  if (!editing) return
  const it = editing.item
  const [sx, sy] = toScreen(editing.pi, it.x, it.y)
  const fs = it.s * view.s
  Object.assign(el.textBox.style, { left: sx - 6 + 'px', top: sy - 4 + 'px', width: it.w * view.s + 12 + 'px' })
  Object.assign(el.textArea.style, { font: `${it.b ? 600 : 400} ${fs}px ${FONTS[it.f] || FONTS.sans}`, lineHeight: 1.35, color: inkFor(it.c, nb.paper) })
  autoGrow()
  const bw = el.textBar.offsetWidth || 360
  let by = sy - 64
  if (by < 8) by = sy + Math.max(fs * 1.4, el.textArea.offsetHeight) + 14
  el.textBar.style.left = Math.max(8, Math.min(W - bw - 8, sx - 6)) + 'px'
  el.textBar.style.top = Math.min(H - 60, by) + 'px'
}
function autoGrow() { const ta = el.textArea; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
function finishText() {
  if (!editing) return
  const { pi, item, isNew, before } = editing
  editing = null
  el.textBox.hidden = true
  el.textBar.hidden = true
  el.textArea.blur()
  item.text = el.textArea.value.replace(/\s+$/, '')
  invalidate(item)
  const page = doc.pages[pi].items
  const idx = page.findIndex(x => x.id === item.id)
  if (!item.text) {
    if (idx >= 0) { page.splice(idx, 1); commit({ pi, before, after: [] }) }
  } else {
    layoutText(item)
    if (idx < 0) page.push(item)
    const after = snapItems(pi, new Set([item.id]))
    if (JSON.stringify(after) !== JSON.stringify(before)) commit({ pi, before, after })
  }
  requestRender()
}
function syncTextBar() {
  if (!editing) return
  const it = editing.item
  el.textBar.querySelectorAll('[data-font]').forEach(b => b.classList.toggle('on', b.dataset.font === it.f))
  el.textSize.textContent = Math.round(it.s)
  el.textBold.classList.toggle('on', !!it.b)
  el.textColor.style.background = it.c
}
function textChange(patch) {
  if (!editing) return
  Object.assign(editing.item, patch)
  invalidate(editing.item)
  if (patch.s || patch.f) { settings.textSize = editing.item.s; settings.textFont = editing.item.f; saveSettings() }
  styleTextBox(); syncTextBar()
  el.textArea.focus()
}

// ------------------------------------------------------------- pictures

async function insertImages(files, at) {
  const imgs = [...files].filter(f => f && f.type && f.type.startsWith('image/'))
  if (!imgs.length) return false
  const items = []
  const pi = isJ() ? curPage : 0
  let off = 0
  for (const f of imgs) {
    try {
      const { blob, w, h } = await prepImage(f)
      const id = await addBlob(blob)
      const vr = viewRect()
      const maxW = isJ() ? size[0] * 0.7 : (vr[2] - vr[0]) * 0.5
      const k = Math.min(1, maxW / w, (isJ() ? size[1] * 0.6 : (vr[3] - vr[1]) * 0.6) / h)
      const iw = w * k, ih = h * k
      let cx, cy
      if (at) { cx = at[0]; cy = at[1] }
      else { cx = (vr[0] + vr[2]) / 2; cy = (vr[1] + vr[3]) / 2 - (isJ() ? pageTop(pi) : 0) }
      if (isJ()) { cx = Math.max(iw / 2 + 10, Math.min(size[0] - iw / 2 - 10, cx)); cy = Math.max(ih / 2 + 10, Math.min(size[1] - ih / 2 - 10, cy)) }
      items.push({ id: uid(), t: 'i', blob: id, x: r2(cx - iw / 2 + off), y: r2(cy - ih / 2 + off), w: r2(iw), h: r2(ih) })
      off += 24
    } catch (err) { toast('Could not read that picture') }
  }
  if (!items.length) return true
  addItems(pi, items)
  setTool('lasso')
  select(pi, items.map(i => i.id), true)
  requestRender()
  return true
}

/** Very large photos are scaled to 3200 px on the long side; everything else is kept as is. */
async function prepImage(file) {
  const bmp = await createImageBitmap(file)
  const w = bmp.width, hh = bmp.height, M = 2400
  // Small enough already: keep the original bytes.
  if (Math.max(w, hh) <= M && file.size <= 600 * 1024) { bmp.close?.(); return { blob: file, w, h: hh } }
  const k = Math.min(1, M / Math.max(w, hh))
  const c = document.createElement('canvas')
  c.width = Math.round(w * k); c.height = Math.round(hh * k)
  const g = c.getContext('2d')
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  // Keep transparency only when the picture actually has some; everything else becomes a JPEG.
  let alpha = false
  if (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif') {
    const d = g.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break }
  }
  let blob = await new Promise(r => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.85))
  if (blob.size > file.size && k === 1) blob = file
  return { blob, w: c.width, h: c.height }
}

async function pasteFromClipboard() {
  try {
    if (!navigator.clipboard?.read) throw 0
    const list = await navigator.clipboard.read()
    const files = []
    for (const ci of list) {
      const type = ci.types.find(t => t.startsWith('image/'))
      if (type) files.push(new File([await ci.getType(type)], 'pasted', { type }))
      else if (ci.types.includes('text/plain')) {
        const text = await (await ci.getType('text/plain')).text()
        if (text.trim()) { pasteText(text); return }
      }
    }
    if (files.length) await insertImages(files)
    else if (!pasteClip()) toast('Nothing to paste')
  } catch { if (!pasteClip()) toast('Allow paste, or use the keyboard paste shortcut') }
}
function pasteText(text) {
  const vr = viewRect()
  const pi = isJ() ? curPage : 0
  const x = isJ() ? 80 : vr[0] + 80, y = (vr[1] + vr[3]) / 2 - (isJ() ? pageTop(pi) : 0)
  const s = settings.textSize || 22
  const it = { id: uid(), t: 't', x, y, w: isJ() ? size[0] - 160 : 520, h: s, s, f: settings.textFont || 'sans', b: false, c: penCfg('ball').c, text: text.trim() }
  layoutText(it)
  addItems(pi, [it])
  requestRender()
}

// ------------------------------------------------------------- pages and the page list

function afterPages() {
  nb.pages = doc.pages.length
  buildRail()
  clampView()
  requestRender()
  updatePageInfo()
}
function pagesOp(fn) {
  const before = doc.pages.slice()
  fn()
  undoStack.push({ kind: 'pages', before, after: doc.pages.slice() })
  redoStack = []
  updateUndo()
  touch(nb.id, { order: true })
  afterPages()
}
function addPage(at = curPage + 1) {
  fx.feedback('page')
  pagesOp(() => doc.pages.splice(at, 0, { id: uid(), items: [] }))
  goPage(at)
}
async function deletePage(i) {
  if (doc.pages.length === 1) { toast('A journal keeps at least one page'); return }
  const has = doc.pages[i].items.length
  if (has && !(await confirmSheet('Delete page ' + (i + 1) + '?', 'You can bring it back with Undo.', 'Delete', { danger: true }))) return
  pagesOp(() => doc.pages.splice(i, 1))
}
function dupPage(i) { pagesOp(() => doc.pages.splice(i + 1, 0, { id: uid(), items: clean(doc.pages[i].items).map(it => ({ ...it, id: uid() })) })) }
function movePage(i, d) { const j = i + d; if (j < 0 || j >= doc.pages.length) return; pagesOp(() => { const [p] = doc.pages.splice(i, 1); doc.pages.splice(j, 0, p) }) }

function goPage(i, smooth = true) {
  if (!isJ()) return
  const target = 18 - pageTop(i) * view.s
  if (!smooth) { view.y = target; clampView(); requestRender(); updatePageInfo(); return }
  const from = view.y, t0 = performance.now()
  cancelInertia()
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 260), e = 1 - Math.pow(1 - k, 3)
    view.y = from + (target - from) * e
    clampView(); render(); placeChrome()
    if (k < 1) inertia = requestAnimationFrame(step); else { inertia = 0; updatePageInfo() }
  }
  inertia = requestAnimationFrame(step)
}

function updatePageInfo() {
  if (!isJ()) { el.pageChip.textContent = Math.round(view.s * 100) + '%'; el.zoomLbl.textContent = Math.round(view.s * 100) + '%'; return }
  const mid = (H / 2 - view.y) / view.s
  curPage = Math.max(0, Math.min(doc.pages.length - 1, Math.floor((mid + GAP / 2) / (size[1] + GAP))))
  el.pageChip.textContent = `Page ${curPage + 1} of ${doc.pages.length}`
  el.zoomLbl.textContent = Math.round(view.s * 100) + '%'
  el.pagesList.querySelectorAll('.pg').forEach((t, i) => t.classList.toggle('on', i === curPage))
  const on = el.pagesList.children[curPage]
  if (on && settings.railOpen && !railScrolling) { const r = on.getBoundingClientRect(), L = el.pagesList.getBoundingClientRect(); if (r.top < L.top || r.bottom > L.bottom) on.scrollIntoView({ block: 'nearest' }) }
}
let railScrolling = false

const thumbDirty = new Set()
let thumbT = 0
function markThumb(pi) { if (pi === undefined || !isJ()) return; thumbDirty.add(pi); clearTimeout(thumbT); thumbT = setTimeout(drawDirtyThumbs, 700) }
function drawDirtyThumbs() { for (const i of thumbDirty) drawThumb(i); thumbDirty.clear() }
function drawThumb(i) {
  const tile = el.pagesList.children[i]
  if (!tile) return
  const c = tile.querySelector('canvas')
  const tw = 96, s = tw / size[0]
  c.width = Math.round(size[0] * s * 2); c.height = Math.round(size[1] * s * 2)
  const g = c.getContext('2d')
  g.setTransform(s * 2, 0, 0, s * 2, 0, 0)
  drawPage(g, nb, doc.pages[i], size, null, s * 2)
}

function buildRail() {
  if (!isJ()) return
  el.pagesList.replaceChildren()
  doc.pages.forEach((p, i) => {
    const tile = h('div', { class: 'pg' + (i === curPage ? ' on' : '') },
      h('button', { class: 'pgT', 'aria-label': 'Go to page ' + (i + 1), onclick: () => { goPage(i); if (W < 720) toggleRail(false) } }, h('canvas', { class: nb.orient === 'h' ? 'hz' : '' })),
      h('div', { class: 'pgN' }, h('span', {}, String(i + 1)), iconBtn('more', 'Page ' + (i + 1) + ' options', (e) => menu(e.currentTarget, [
        { label: 'Add page after', icon: 'addPage', run: () => addPage(i + 1) },
        { label: 'Duplicate', icon: 'dup', run: () => dupPage(i) },
        { label: 'Move up', icon: 'back', run: () => movePage(i, -1) },
        { label: 'Move down', icon: 'down', run: () => movePage(i, 1) },
        '-',
        { label: 'Delete page', icon: 'trash', danger: true, run: () => deletePage(i) }
      ]), 'ic sm')))
    el.pagesList.append(tile)
  })
  el.pagesList.append(h('button', { class: 'pgAdd', onclick: () => addPage(doc.pages.length) }, icon('plus'), 'Add page'))
  // Thumbnails are drawn as they scroll into view.
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { const i = [...el.pagesList.children].indexOf(en.target); if (i >= 0 && i < doc.pages.length) drawThumb(i); io.unobserve(en.target) } }, { root: el.pagesList, rootMargin: '200px' })
  ;[...el.pagesList.querySelectorAll('.pg')].forEach(t => io.observe(t))
}

function toggleRail(open = !el.ed.classList.contains('railOpen')) {
  if (innerWidth > 720) { settings.railOpen = open; saveSettings() }
  el.ed.classList.toggle('railOpen', open && isJ())
  el.railBtn.classList.toggle('on', open)
  el.railBtn.setAttribute('aria-expanded', String(open))
  setTimeout(resize, 230)
}

// ------------------------------------------------------------- tray

function buildTray() {
  const t = el.tray
  t.replaceChildren()
  t.className = 'tray ' + (settings.tray || 'bottom') + (settings.ux === 'tactile' ? ' tactile' : '')
  const pens = h('div', { class: 'tg pens' })
  for (const p of PEN_ORDER) {
    const b = h('button', { class: 'penB', 'data-pen': p, 'aria-label': PENS[p].name, title: PENS[p].name, onclick: (e) => {
      if (tool === 'pen' && pen === p) { penPop(e.currentTarget); return }
      pen = p; setTool('pen')
    } })
    b.innerHTML = penSVG(p, penCfg(p).c)
    pens.append(b)
  }
  const tools = h('div', { class: 'tg tools' },
    toolBtn('eraser', 'Eraser', 'eraser'),
    toolBtn('lasso', 'Lasso: select, move, resize', 'lasso'),
    toolBtn('shape', 'Shapes', 'shapes'),
    toolBtn('text', 'Text', 'text'),
    h('button', { class: 'ic tb', 'data-tool': 'image', 'aria-label': 'Add picture', title: 'Add picture', onclick: (e) => imagePop(e.currentTarget) }, icon('image')))
  const colors = h('div', { class: 'tg colors' })
  t.append(pens, h('i', { class: 'tsep' }), tools, h('i', { class: 'tsep' }), colors)
  fillColors()
  syncTray()
}
function toolBtn(id, label, ic) {
  return h('button', { class: 'ic tb', 'data-tool': id, 'aria-label': label, title: label, onclick: (e) => {
    if (tool === id && id !== 'lasso') { if (id === 'eraser') eraserPop(e.currentTarget); else if (id === 'shape') shapePop(e.currentTarget); else if (id === 'text') textPop(e.currentTarget); return }
    setTool(id)
    if (id === 'shape' && !settings.shapeSeen) { settings.shapeSeen = true; saveSettings(); shapePop(e.currentTarget) }
  } }, icon(ic))
}
function fillColors() {
  const box = el.tray.querySelector('.colors')
  box.replaceChildren()
  const cur = penCfg().c
  const list = pen === 'high' && tool === 'pen' ? HIGH_COLORS.slice(0, 4) : (settings.recent || COLORS.slice(0, 4)).slice(0, 4)
  for (const c of list) box.append(h('button', { class: 'sw' + (c === cur ? ' on' : ''), 'aria-label': 'Color ' + c, onclick: () => setColor(c) }, h('span', { style: { background: c } })))
  box.append(h('button', { class: 'sw more', 'aria-label': 'More colors', onclick: (e) => penPop(e.currentTarget) }, h('span')))
}
function setColor(c) {
  if (tool !== 'pen') { if (sel) { recolorSel(c); return } if (editing) { textChange({ c }); return } }
  const target = tool === 'pen' ? pen : 'ball'
  penCfg(target).c = c
  if (target !== 'high') {
    settings.color = c
    settings.recent = [c, ...(settings.recent || []).filter(x => x !== c)].slice(0, 6)
  }
  saveSettings()
  buildTray()
}
function setTool(t, keepText = false) {
  if (!keepText && editing) finishText()
  if (t !== 'lasso') clearSel()
  tool = t
  hover = null
  closePop()
  syncTray()
  el.surface.dataset.tool = t
}
/** Used by the tactile pen case once a pen is in hand. */
export function choosePen(p) { pen = p; setTool('pen') }
export function chooseTool(t) { setTool(t) }
export const currentPen = () => (tool === 'pen' ? pen : null)
export const currentTool = () => tool
export const penInk = (p) => penCfg(p).c

function syncTray() {
  caseSync()
  el.tray.querySelectorAll('.penB').forEach(b => {
    const on = tool === 'pen' && b.dataset.pen === pen
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  })
  el.tray.querySelectorAll('.tb').forEach(b => {
    const on = b.dataset.tool === tool
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  })
  fillColors()
}

function slider(label, min, max, step, val, fmt, onInput) {
  const out = h('output', {}, fmt(val))
  const inp = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label })
  const paint = () => inp.style.setProperty('--v', ((inp.value - min) / (max - min)) * 100 + '%')
  paint()
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); paint(); onInput(+inp.value) })
  return h('label', { class: 'sl' }, h('span', { class: 'slT' }, h('span', {}, label), out), inp)
}

function penPop(anchor) {
  if (!anchor || !anchor.isConnected) anchor = el.tray.querySelector('.penB.on') || el.tray.querySelector('.colors .more') || el.tray
  const p = tool === 'pen' ? pen : 'ball'
  const cfg = penCfg(p)
  const preview = h('canvas', { class: 'pv', width: 560, height: 120 })
  const drawPrev = () => {
    const g = preview.getContext('2d')
    g.setTransform(2, 0, 0, 2, 0, 0)
    g.clearRect(0, 0, 280, 60)
    const pts = []
    for (let i = 0; i <= 60; i++) { const x = 20 + i * 4, y = 30 + Math.sin(i / 7) * 14; pts.push(x, y, 0.5 + 0.5 * Math.sin(i / 12)) }
    const it = { t: 's', pen: p, c: cfg.c, w: cfg.w, pts, nib: settings.nib ?? 40 }
    g.fillStyle = cfg.c
    g.globalAlpha = p === 'high' ? 0.42 : p === 'pencil' ? 0.82 : 1
    g.fill(new Path2D(strokePath(it)))
  }
  const sizes = h('div', { class: 'seg' }, PENS[p].sizes.map((s, i) => h('button', { class: Math.abs(cfg.w - s) < 0.01 ? 'on' : '', 'aria-label': ['Fine', 'Medium', 'Bold'][i], onclick: () => { cfg.w = s; saveSettings(); penPop(anchor) } }, h('i', { class: 'dotS', style: { width: 4 + i * 4 + 'px', height: 4 + i * 4 + 'px' } }))))
  const grid = h('div', { class: 'cgrid' })
  for (const c of (p === 'high' ? HIGH_COLORS : COLORS)) grid.append(h('button', { class: 'sw' + (c === cfg.c ? ' on' : ''), 'aria-label': 'Color ' + c, onclick: () => { setColor(c); penPop(anchor) } }, h('span', { style: { background: c } })))
  const custom = h('input', { type: 'color', value: cfg.c, 'aria-label': 'Custom color' })
  custom.addEventListener('change', () => { setColor(custom.value); penPop(anchor) })
  grid.append(h('label', { class: 'sw custom', title: 'Custom color' }, custom, h('span')))
  const body = h('div', { class: 'penPop' },
    h('div', { class: 'popH' }, h('b', {}, PENS[p].name), h('span', { class: 'mute' }, { ball: 'Even line for quick notes', fountain: 'Pressure and speed shape the line', pencil: 'Tilt the pen to shade', calli: 'Broad nib: thick and thin strokes', marker: 'Bold, even strokes', high: 'Goes behind your writing, snaps straight' }[p])),
    preview,
    h('div', { class: 'popRow' }, h('span', { class: 'slT' }, 'Size'), sizes),
    slider('Thickness', 0.5, p === 'high' ? 40 : 20, 0.1, cfg.w, v => v.toFixed(1) + ' pt', v => { cfg.w = v; saveSettings(); drawPrev() }),
    p === 'calli' ? slider('Nib angle', 0, 90, 1, settings.nib ?? 40, v => v + '°', v => { settings.nib = v; saveSettings(); drawPrev() }) : null,
    h('label', { class: 'tg2' }, h('span', {}, 'Pressure sensitivity'), toggle(settings.pressure !== false, v => { settings.pressure = v; saveSettings() })),
    h('div', { class: 'slT' }, 'Color'), grid)
  popover(anchor, body, { side: trayPopSide() })
  drawPrev()
}
function trayPopSide() { return settings.tray === 'left' ? 'right' : settings.tray === 'right' ? 'left' : 'above' }
function eraserPop(anchor) {
  popover(anchor, h('div', { class: 'penPop' }, h('div', { class: 'popH' }, h('b', {}, 'Eraser'), h('span', { class: 'mute' }, 'Removes whole strokes it touches')),
    slider('Size', 4, 40, 1, eraserR(), v => v + ' pt', v => { settings.eraserR = v; saveSettings() }),
    h('p', { class: 'mute small' }, 'Stylus with an eraser end or side button? It erases while you hold it.')), { side: trayPopSide() })
}
function shapePop(anchor) {
  const k = [['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']]
  popover(anchor, h('div', { class: 'penPop' }, h('div', { class: 'popH' }, h('b', {}, 'Shapes'), h('span', { class: 'mute' }, 'Drag to draw. Lines snap to angles.')),
    h('div', { class: 'seg four' }, k.map(([id, name]) => h('button', { class: settings.shape === id ? 'on' : '', 'aria-label': name, title: name, onclick: () => { settings.shape = id; saveSettings(); closePop() } }, icon(id === 'ellipse' ? 'ellipse' : id), h('span', {}, name))))), { side: trayPopSide() })
}
function textPop(anchor) {
  popover(anchor, h('div', { class: 'penPop' }, h('div', { class: 'popH' }, h('b', {}, 'Text'), h('span', { class: 'mute' }, 'Tap the page to type. Tap text to edit it.'))), { side: trayPopSide() })
}
function imagePop(anchor) {
  menu(anchor, [
    { label: 'Photos or files', icon: 'image', run: () => el.filePick.click() },
    { label: 'Paste picture', icon: 'paste', run: () => pasteFromClipboard() }
  ], { side: trayPopSide() })
}
export function toggle(on, onChange, label) {
  const b = h('button', { class: 'tgl' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label || 'Toggle', onclick: () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); onChange(on) } }, h('i'))
  return b
}

// ------------------------------------------------------------- top bar menus

function liningMenu(anchor) {
  const L = isJ() ? LININGS_J : LININGS_C
  const box = h('div', { class: 'penPop' }, h('div', { class: 'slT' }, 'Lining'))
  const grid = h('div', { class: 'lgrid' })
  for (const [id, name] of L) {
    const sw = h('canvas', { width: 120, height: 84 })
    const g = sw.getContext('2d')
    g.setTransform(0.6, 0, 0, 0.6, 0, 0)
    g.fillStyle = (PAPERS[nb.paper] || PAPERS.white).bg; g.fillRect(0, 0, 200, 140)
    drawLining(g, id, nb.paper, [0, 0, 200, 140], 0.6, isJ() ? [200, 1000] : null)
    grid.append(h('button', { class: 'lt' + (nb.lining === id ? ' on' : ''), onclick: () => { updateNotebook(nb.id, { lining: id }); requestRender(); buildRail(); liningMenu(anchor); el.liningLbl.textContent = name } }, sw, h('span', {}, name)))
  }
  const papers = h('div', { class: 'row' })
  for (const [id, P] of Object.entries(PAPERS)) papers.append(h('button', { class: 'sw lg' + (nb.paper === id ? ' on' : ''), 'aria-label': P.name + ' paper', title: P.name, onclick: () => { updateNotebook(nb.id, { paper: id }); requestRender(); buildRail(); liningMenu(anchor) } }, h('span', { style: { background: P.bg } })))
  box.append(grid, h('div', { class: 'slT' }, 'Paper'), papers)
  popover(anchor, box, { side: 'below' })
}

async function exportMenu(anchor) {
  menu(anchor, [
    isJ() ? { label: 'This page as SVG', icon: 'share', run: exportPageSVG } : { label: 'Canvas as SVG', icon: 'share', run: exportPageSVG },
    { label: isJ() ? 'Whole journal as PDF' : 'Canvas as PDF', icon: 'paper', run: printPDF },
    '-',
    { label: 'Rename', icon: 'pen', run: rename }
  ], { side: 'below' })
}
function contentRegion() {
  const items = doc.pages[0].items
  if (!items.length) return [0, 0, 800, 600]
  let b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const it of items) { if (it.t === 't') layoutText(it); const q = bbox(it); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] }
  return [Math.floor(b[0] - 40), Math.floor(b[1] - 40), Math.ceil(b[2] - b[0] + 80), Math.ceil(b[3] - b[1] + 80)]
}
async function exportPageSVG() {
  finishText()
  const svg = isJ() ? await pageSVG(nb, doc.pages[curPage], size) : await pageSVG(nb, doc.pages[0], null, contentRegion())
  download(new Blob([svg], { type: 'image/svg+xml' }), `${nb.title}${isJ() ? ' p' + (curPage + 1) : ''}.svg`)
}
async function printPDF() {
  finishText()
  toast('Preparing pages…')
  const box = $('#print')
  box.replaceChildren()
  const st = h('style', {}, isJ() ? `@page{size:A4 ${nb.orient === 'h' ? 'landscape' : 'portrait'};margin:0}` : '@page{margin:10mm}')
  box.append(st)
  const list = isJ() ? doc.pages.map(p => pageSVG(nb, p, size)) : [pageSVG(nb, doc.pages[0], null, contentRegion())]
  for (const s of await Promise.all(list)) box.append(h('div', { class: 'pp' + (isJ() ? '' : ' fitp'), html: s }))
  document.title = nb.title
  setTimeout(() => { window.print(); document.title = 'CocoaNotes' }, 120)
}
async function rename() {
  const t = await promptSheet('Rename', nb.title)
  if (t) { updateNotebook(nb.id, { title: t }); el.title.textContent = t }
}

// ------------------------------------------------------------- chrome positions

function placeChrome() {
  if (sel) placeSel()
  if (editing) styleTextBox()
  if (isJ()) {
    const y = view.y + (totalH() + 22) * view.s
    const show = y < H - 40 && y > 40
    el.addBelow.hidden = !show
    if (show) { el.addBelow.style.top = y + 'px'; el.addBelow.style.left = view.x + size[0] * view.s / 2 + 'px' }
  } else el.addBelow.hidden = true
}

function resize() {
  if (!nb) return
  const r = el.surface.getBoundingClientRect()
  const oldW = W
  dpr = Math.min(window.devicePixelRatio || 1, 3)
  W = Math.max(1, r.width); H = Math.max(1, r.height)
  for (const c of [el.main, el.ink]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px' }
  if (oldW && isJ()) { const k = W / oldW; const pw = size[0] * view.s; if (pw < oldW) view.x = (W - pw) / 2 } else if (!oldW) fit()
  clampView()
  render(); renderInk(); placeChrome(); updatePageInfo()
}

// ------------------------------------------------------------- open / close

export async function openEditor(id, onClose) {
  // Load first, then switch over in one step, so nothing draws a half-opened notebook.
  const nNb = state.notebooks.get(id)
  const nDoc = await openDoc(id)
  nb = nNb; doc = nDoc
  size = isJ() ? pageSizeOf(nb) : null
  window.__cnOpen = id
  undoStack = []; redoStack = []; sel = null; editing = null; live = null; lasso = null; W = 0
  curPage = isJ() ? Math.min(nb.lastPage || 0, doc.pages.length - 1) : 0
  el.ed.classList.toggle('isCanvas', !isJ())
  el.pageChip.hidden = !isJ()
  // On phones the page list is a drawer, so it starts closed.
  const railNow = !!settings.railOpen && isJ() && innerWidth > 720
  el.ed.classList.toggle('railOpen', railNow)
  el.railBtn.classList.toggle('on', railNow)
  el.title.textContent = nb.title
  const subj = state.subjects.find(s => s.id === nb.subject)
  el.subj.hidden = !subj
  if (subj) el.subj.replaceChildren(h('i', { style: { background: subj.color } }), subj.name)
  el.liningLbl.textContent = (isJ() ? LININGS_J : LININGS_C).find(l => l[0] === nb.lining)?.[1] || 'Lining'
  el.closeCb = onClose
  buildTray(); buildRail(); updateUndo(); clearSel()
  requestAnimationFrame(() => { resize(); fit(curPage); requestRender(); updatePageInfo() })
}
const pageSizeOf = (n) => pageSize(n)

export async function closeEditor() {
  finishText()
  if (nb && isJ()) { nb.lastPage = curPage; touch(nb.id, { meta: true }) }
  await flush()
  window.__cnOpen = null
  nb = null; doc = null
  closePop()
}

// ------------------------------------------------------------- setup (once)

export function initEditor() {
  el = {
    ed: $('#ed'), surface: $('#surface'), main: $('#cMain'), ink: $('#cInk'), tray: $('#tray'),
    undo: $('#undo'), redo: $('#redo'), railBtn: $('#railBtn'), pagesList: $('#pages'), pageChip: $('#pageChip'),
    title: $('#edTitle'), subj: $('#edSubj'), liningLbl: $('#liningLbl'), zoomLbl: $('#zoomLbl'),
    sel: $('#sel'), selBar: $('#selBar'), selEdit: $('#selEdit'), textBox: $('#textBox'), textArea: $('#textArea'), textBar: $('#textBar'),
    textSize: $('#tSize'), textBold: $('#tBold'), textColor: $('#tColor'), filePick: $('#filePick'), addBelow: $('#addBelow')
  }
  ctx = el.main.getContext('2d', { alpha: false })
  ictx = el.ink.getContext('2d', { desynchronized: true }) || el.ink.getContext('2d')
  setImageListener(() => { requestRender(); if (nb && isJ()) for (let i = 0; i < doc.pages.length; i++) if (doc.pages[i].items.some(it => it.t === 'i')) markThumb(i) })

  const s = el.surface
  s.addEventListener('pointerdown', onDown, { passive: false })
  s.addEventListener('pointermove', onMove, { passive: false })
  s.addEventListener('pointerup', onUp)
  s.addEventListener('pointercancel', onUp)
  s.addEventListener('pointerleave', (e) => { if (e.pointerType === 'pen' && hover) { hover = null; requestInk() } })
  s.addEventListener('contextmenu', e => e.preventDefault())
  // Safari: stop the page from scrolling or zooming under the pen.
  s.addEventListener('touchstart', e => e.preventDefault(), { passive: false })
  s.addEventListener('touchmove', e => e.preventDefault(), { passive: false })
  s.addEventListener('wheel', (e) => {
    if (!nb) return
    e.preventDefault()
    cancelInertia()
    const r = s.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 4 : 1))
      const ns = Math.max(minS(), Math.min(maxS(), view.s * k))
      const wx = (mx - view.x) / view.s, wy = (my - view.y) / view.s
      view.s = ns; view.x = mx - wx * ns; view.y = my - wy * ns
    } else {
      const m = e.deltaMode ? 30 : 1
      view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * m
      if (!e.shiftKey) view.y -= e.deltaY * m
    }
    clampView(); requestRender()
    clearTimeout(s._wt); s._wt = setTimeout(updatePageInfo, 80)
  }, { passive: false })
  // Trackpad pinch in Safari on a Mac.
  let gs = null
  s.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = { s: view.s, x: view.x, y: view.y, cx: e.clientX, cy: e.clientY } })
  s.addEventListener('gesturechange', (e) => {
    if (!gs) return
    e.preventDefault()
    const r = s.getBoundingClientRect(), mx = gs.cx - r.left, my = gs.cy - r.top
    const ns = Math.max(minS(), Math.min(maxS(), gs.s * e.scale)), wx = (mx - gs.x) / gs.s, wy = (my - gs.y) / gs.s
    view.s = ns; view.x = mx - wx * ns; view.y = my - wy * ns; clampView(); requestRender()
  })
  s.addEventListener('gestureend', () => { gs = null; updatePageInfo() })

  s.addEventListener('dragover', e => { e.preventDefault(); s.classList.add('drop') })
  s.addEventListener('dragleave', () => s.classList.remove('drop'))
  s.addEventListener('drop', (e) => {
    e.preventDefault(); s.classList.remove('drop')
    const r = s.getBoundingClientRect()
    const L = locate(e.clientX - r.left, e.clientY - r.top)
    if (e.dataTransfer?.files?.length) { if (isJ()) curPage = L.pi; insertImages(e.dataTransfer.files, [L.x, L.y]) }
  })
  document.addEventListener('paste', (e) => {
    if (!nb || $('#ed').hidden) return
    if (editing || e.target.closest?.('input,textarea,[contenteditable]')) return
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); insertImages(files); return }
    const text = e.clipboardData?.getData('text/plain')
    if (clip && (!text || text === ' ' || clip.items.some(i => i.t === 't' && text.includes(i.text)))) { e.preventDefault(); pasteClip(); return }
    if (text && text.trim()) { e.preventDefault(); pasteText(text) }
  })
  document.addEventListener('copy', (e) => { if (nb && sel && !editing) { e.preventDefault(); copySel() } })
  document.addEventListener('cut', (e) => { if (nb && sel && !editing) { e.preventDefault(); copySel(true) } })
  el.filePick.addEventListener('change', () => { insertImages(el.filePick.files); el.filePick.value = '' })

  document.addEventListener('keydown', (e) => {
    if (!nb || $('#ed').hidden) return
    if (e.key === ' ' && !editing && !e.target.closest('input,textarea')) { spaceDown = true; el.surface.classList.add('grab'); e.preventDefault() }
    if (editing || e.target.closest('input,textarea,select')) { if (e.key === 'Escape' && editing) finishText(); return }
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel() }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.25) }
    else if (mod && e.key === '-') { e.preventDefault(); zoomBy(0.8) }
    else if (mod && e.key === '0') { e.preventDefault(); fit(); requestRender(); updatePageInfo() }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel() }
    else if (e.key === 'Escape') { clearSel(); closePop() }
    else if (!mod && /^[1-6]$/.test(e.key)) { pen = PEN_ORDER[+e.key - 1]; setTool('pen') }
    else if (!mod && e.key === 'e') setTool('eraser')
    else if (!mod && e.key === 'l') setTool('lasso')
    else if (!mod && e.key === 't') setTool('text')
    else if (!mod && e.key === 's') setTool('shape')
    else if (!mod && isJ() && (e.key === 'PageDown' || e.key === 'ArrowDown' && e.altKey)) goPage(Math.min(doc.pages.length - 1, curPage + 1))
    else if (!mod && isJ() && (e.key === 'PageUp' || e.key === 'ArrowUp' && e.altKey)) goPage(Math.max(0, curPage - 1))
  })
  document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; el.surface.classList.remove('grab') } })

  // selection box and bar
  $('#selHandle').addEventListener('pointerdown', startScale)
  $('#selCopy').onclick = () => copySel()
  $('#selDup').onclick = () => duplicateSel()
  $('#selDel').onclick = () => deleteSel()
  $('#selColor').onclick = (e) => {
    const grid = h('div', { class: 'cgrid' }, COLORS.map(c => h('button', { class: 'sw', 'aria-label': 'Color ' + c, onclick: () => { recolorSel(c); closePop() } }, h('span', { style: { background: c } }))))
    popover(e.currentTarget, h('div', { class: 'penPop' }, h('div', { class: 'slT' }, 'Color'), grid), { side: 'below' })
  }
  el.selEdit.onclick = () => { const it = doc.pages[sel.pi].items.find(x => sel.ids.has(x.id)); if (it) editText(sel.pi, it) }

  // text box
  el.textArea.addEventListener('input', () => { if (editing) { editing.item.text = el.textArea.value; autoGrow() } })
  el.textArea.addEventListener('blur', () => setTimeout(() => { if (editing && !el.textBar.contains(document.activeElement) && document.activeElement !== el.textArea && !document.querySelector('.pop')) finishText() }, 150))
  el.textBar.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => textChange({ f: b.dataset.font })))
  $('#tMinus').onclick = () => textChange({ s: Math.max(8, Math.round(editing.item.s - 2)) })
  $('#tPlus').onclick = () => textChange({ s: Math.min(160, Math.round(editing.item.s + 2)) })
  el.textBold.onclick = () => textChange({ b: !editing.item.b })
  el.textColor.onclick = (e) => {
    const grid = h('div', { class: 'cgrid' }, COLORS.map(c => h('button', { class: 'sw', 'aria-label': 'Color ' + c, onclick: () => { textChange({ c }); closePop() } }, h('span', { style: { background: c } }))))
    popover(e.currentTarget, h('div', { class: 'penPop' }, grid), { side: 'below' })
  }
  $('#tDone').onclick = () => { finishText(); setTool('pen') }
  $('#textGrip').addEventListener('pointerdown', (e) => {
    // Drag the right edge to change the width the text wraps at.
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX, w0 = editing.item.w
    const mv = (ev) => { editing.item.w = Math.max(60, w0 + (ev.clientX - x0) / view.s); invalidate(editing.item); styleTextBox() }
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); el.textArea.focus() }
    addEventListener('pointermove', mv); addEventListener('pointerup', up)
  })

  // top bar
  el.undo.onclick = undo
  el.redo.onclick = redo
  el.railBtn.onclick = () => toggleRail()
  $('#railClose').onclick = () => toggleRail(false)
  $('#railScrim').onclick = () => toggleRail(false)
  $('#liningBtn').onclick = (e) => liningMenu(e.currentTarget)
  $('#addPage').onclick = () => addPage()
  el.addBelow.onclick = () => addPage(doc.pages.length)
  $('#exportBtn').onclick = (e) => exportMenu(e.currentTarget)
  el.title.onclick = rename
  $('#edBack').onclick = async () => { const cb = el.closeCb; await closeEditor(); cb && cb() }
  $('#zIn').onclick = () => zoomBy(1.25)
  $('#zOut').onclick = () => zoomBy(0.8)
  $('#zFit').onclick = () => { fit(); requestRender(); updatePageInfo() }
  el.pagesList.addEventListener('scroll', () => { railScrolling = true; clearTimeout(el.pagesList._t); el.pagesList._t = setTimeout(() => { railScrolling = false }, 400) })
  syncChip($('#syncChip'))
  initCase($('#stage'))

  new ResizeObserver(() => resize()).observe(el.surface)
  onStore((ev) => { if (ev === 'settings' && nb) el.tray.className = 'tray ' + (settings.tray || 'bottom') + (settings.ux === 'tactile' ? ' tactile' : '') })
}

function zoomBy(k) {
  const ns = Math.max(minS(), Math.min(maxS(), view.s * k))
  const wx = (W / 2 - view.x) / view.s, wy = (H / 2 - view.y) / view.s
  view.s = ns; view.x = W / 2 - wx * ns; view.y = H / 2 - wy * ns
  clampView(); requestRender(); updatePageInfo()
}

export const editorOpen = () => !!nb
