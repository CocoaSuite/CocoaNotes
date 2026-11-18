// Drawing pages, paper and items. The same code draws the screen, page thumbnails and prints.
import { bbox, path2d, strokePath } from './ink.js'
import { db } from './db.js'

// A4 at 96 dpi, in page units.
export const A4 = { v: [794, 1123], h: [1123, 794] }
export const GAP = 28

export const PAPERS = {
  white: { name: 'White', bg: '#ffffff', ln: '#c9d3e0', dt: '#aab5c4', mg: '#e3a07a' },
  cream: { name: 'Cream', bg: '#f7f1e3', ln: '#d8ccb2', dt: '#bfae8d', mg: '#dd9a72' },
  gray: { name: 'Gray', bg: '#e9e9e6', ln: '#c6c6c1', dt: '#a9a9a3', mg: '#d4936d' },
  dark: { name: 'Dark', bg: '#24221f', ln: '#3e3a35', dt: '#55504a', mg: '#7a4a33' }
}
export const LININGS_J = [['blank', 'Blank'], ['ruled', 'Ruled'], ['college', 'College'], ['grid', 'Grid'], ['dotted', 'Dotted'], ['cornell', 'Cornell']]
export const LININGS_C = [['blank', 'Blank'], ['grid', 'Grid'], ['dotted', 'Dotted'], ['ruled', 'Ruled']]
export const FONTS = { sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', serif: 'Georgia, "Times New Roman", serif', hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive', mono: 'ui-monospace, Menlo, Consolas, monospace' }

/** Ink colors read on dark paper too: very dark inks flip to light there. */
export function inkFor(color, paper) {
  if (paper !== 'dark') return color
  const n = parseInt(color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255
  if (0.299 * r + 0.587 * g + 0.114 * b < 70) return '#ececec'
  return color
}

/** Lines of the paper inside the visible rectangle [x0,y0,x1,y1] of a page (or of an endless canvas). */
export function drawLining(ctx, lining, paper, rect, scale, page) {
  const P = PAPERS[paper] || PAPERS.white
  let [x0, y0, x1, y1] = rect
  const hair = 1 / scale
  ctx.lineWidth = hair
  const infinite = !page
  let step = { ruled: 33, college: 27, grid: 19, dotted: 19, cornell: 27 }[lining]
  if (!step) return
  // On an endless canvas, zoomed far out, the grid steps up so it stays readable.
  if (infinite) while (step * scale < 9) step *= 5
  else if (step * scale < 3) return
  const top = page && (lining === 'ruled' || lining === 'college' || lining === 'cornell') ? 96 : 0
  const bottom = page ? page[1] : Infinity
  if (lining === 'dotted') {
    ctx.fillStyle = P.dt
    const r = Math.max(0.9, 1.1 / Math.max(scale, 0.6)) * (infinite ? 1 : 1)
    const sx = Math.floor(x0 / step) * step, sy = Math.floor(y0 / step) * step
    const count = ((x1 - sx) / step) * ((y1 - sy) / step)
    if (count > 60000) return
    ctx.beginPath()
    for (let y = sy; y <= y1; y += step) for (let x = sx; x <= x1; x += step) { if (page && (x <= 0 || y <= 0 || x >= page[0] || y >= page[1])) continue; ctx.rect(x - r, y - r, 2 * r, 2 * r) }
    ctx.fill()
    return
  }
  ctx.strokeStyle = P.ln
  ctx.beginPath()
  if (lining === 'grid') {
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { if (page && (x <= 0 || x >= page[0])) continue; ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
  }
  const origin = page && top > 0 ? top : 0
  const firstY = origin + Math.max(page && top > 0 ? 0 : -Infinity, Math.ceil((y0 - origin) / step)) * step
  for (let y = firstY; y <= y1; y += step) {
    if (page && (y <= 0 || y >= bottom)) continue
    if (lining === 'cornell' && page && y > page[1] - 190) continue
    ctx.moveTo(x0, y); ctx.lineTo(x1, y)
  }
  ctx.stroke()
  if (page && (lining === 'college' || lining === 'cornell' || lining === 'ruled')) {
    ctx.strokeStyle = P.mg
    ctx.lineWidth = Math.max(hair, 1.2)
    ctx.beginPath()
    if (lining === 'college' || lining === 'ruled') { ctx.moveTo(lining === 'college' ? 96 : 72, y0); ctx.lineTo(lining === 'college' ? 96 : 72, y1) }
    if (lining === 'cornell') {
      ctx.moveTo(228, Math.max(y0, 96)); ctx.lineTo(228, Math.min(y1, page[1] - 190))
      ctx.moveTo(x0, page[1] - 190); ctx.lineTo(x1, page[1] - 190)
    }
    ctx.stroke()
  }
}

// ---- images

const IMG = new Map()
let onImage = () => {}
export function setImageListener(fn) { onImage = fn }
export function imageFor(id) {
  const c = IMG.get(id)
  if (c) return c.bmp
  IMG.set(id, { bmp: null })
  db.get('blobs', id).then(async r => {
    if (!r) return
    try {
      const bmp = 'createImageBitmap' in window ? await createImageBitmap(r.blob) : await loadImg(r.blob)
      IMG.set(id, { bmp })
      onImage()
    } catch { }
  })
  return null
}
const loadImg = (blob) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob) })

// ---- text

const mctx = document.createElement('canvas').getContext('2d')
export function fontOf(it) { return `${it.b ? 600 : 400} ${it.s}px ${FONTS[it.f] || FONTS.sans}` }
/** Wraps a text item to its width; returns lines and updates its height. */
export function layoutText(it) {
  if (it._lines) return it._lines
  mctx.font = fontOf(it)
  const lines = []
  for (const para of (it.text || '').split('\n')) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const test = line + w
      if (line && mctx.measureText(test).width > it.w) { lines.push(line.trimEnd()); line = w.trimStart() }
      else line = test
    }
    lines.push(line)
  }
  it._lines = lines
  it.h = Math.max(it.s * 1.35, lines.length * it.s * 1.35)
  delete it._b
  return lines
}

// ---- items

export function drawItems(ctx, items, view, paper, skip) {
  // Pictures first, highlighter behind the writing, then text and ink.
  const vis = (it) => { if (skip && skip.has(it.id)) return false; if (!view) return true; const b = bbox(it); return !(b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) }
  for (const it of items) if (it.t === 'i' && vis(it)) drawImage(ctx, it)
  ctx.save()
  ctx.globalCompositeOperation = paper === 'dark' ? 'screen' : 'multiply'
  for (const it of items) if (it.t === 's' && it.pen === 'high' && vis(it)) drawStroke(ctx, it, paper)
  ctx.restore()
  for (const it of items) {
    if (!vis(it)) continue
    if (it.t === 't') drawText(ctx, it, paper)
    else if (it.t === 's' && it.pen !== 'high') drawStroke(ctx, it, paper)
  }
}

export function drawStroke(ctx, it, paper) {
  ctx.fillStyle = it.pen === 'high' ? it.c : inkFor(it.c, paper)
  const a = it.pen === 'high' ? 0.42 : it.pen === 'pencil' ? (it.a ?? 0.82) : 1
  if (a !== 1) { ctx.globalAlpha = a; ctx.fill(path2d(it)); ctx.globalAlpha = 1 }
  else ctx.fill(path2d(it))
}

export function drawText(ctx, it, paper) {
  const lines = layoutText(it)
  ctx.font = fontOf(it)
  ctx.fillStyle = inkFor(it.c, paper)
  ctx.textBaseline = 'alphabetic'
  const lh = it.s * 1.35
  lines.forEach((l, i) => ctx.fillText(l, it.x, it.y + i * lh + it.s * 1.02))
}

function drawImage(ctx, it) {
  const bmp = imageFor(it.blob)
  if (bmp) ctx.drawImage(bmp, it.x, it.y, it.w, it.h)
  else { ctx.fillStyle = 'rgba(128,128,128,.15)'; ctx.fillRect(it.x, it.y, it.w, it.h) }
}

/** One page, drawn at the context's current transform (page units). */
export function drawPage(ctx, nb, page, size, view, scale, skip) {
  const P = PAPERS[nb.paper] || PAPERS.white
  ctx.fillStyle = P.bg
  ctx.fillRect(0, 0, size[0], size[1])
  const rect = view ? [Math.max(0, view[0]), Math.max(0, view[1]), Math.min(size[0], view[2]), Math.min(size[1], view[3])] : [0, 0, size[0], size[1]]
  drawLining(ctx, nb.lining, nb.paper, rect, scale, size)
  ctx.save()
  ctx.beginPath(); ctx.rect(0, 0, size[0], size[1]); ctx.clip()
  drawItems(ctx, page.items, view, nb.paper, skip)
  ctx.restore()
}

// ---- SVG export (vector)

const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export async function pageSVG(nb, page, size, region) {
  const P = PAPERS[nb.paper] || PAPERS.white
  let [x0, y0, w, h] = region || [0, 0, size[0], size[1]]
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}">`, `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${P.bg}"/>`]
  // Paper lines, drawn as vectors too.
  const c = svgCtx()
  drawLining(c, nb.lining, nb.paper, [x0, y0, x0 + w, y0 + h], 1, region ? null : size)
  parts.push(c.out())
  const items = page.items
  for (const it of items) if (it.t === 'i') {
    const r = await db.get('blobs', it.blob)
    if (r) parts.push(`<image x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="none" href="${await toDataURL(r.blob)}"/>`)
  }
  for (const it of items) if (it.t === 's' && it.pen === 'high') parts.push(`<path d="${strokePath(it)}" fill="${it.c}" fill-opacity="0.42" style="mix-blend-mode:multiply"/>`)
  for (const it of items) {
    if (it.t === 's' && it.pen !== 'high') parts.push(`<path d="${strokePath(it)}" fill="${inkFor(it.c, nb.paper)}"${it.pen === 'pencil' ? ` fill-opacity="${it.a ?? 0.82}"` : ''}/>`)
    if (it.t === 't') {
      const lines = layoutText(it), lh = it.s * 1.35
      parts.push(`<text font-family='${FONTS[it.f] || FONTS.sans}' font-size="${it.s}" font-weight="${it.b ? 600 : 400}" fill="${inkFor(it.c, nb.paper)}">` + lines.map((l, i) => `<tspan x="${it.x}" y="${it.y + i * lh + it.s * 1.02}">${esc(l)}</tspan>`).join('') + '</text>')
    }
  }
  parts.push('</svg>')
  return parts.join('')
}

const toDataURL = (blob) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })

/** A tiny stand-in canvas context that records lines and dots as SVG. */
function svgCtx() {
  let d = '', segs = [], out = []
  const o = {
    lineWidth: 1, strokeStyle: '#000', fillStyle: '#000',
    beginPath() { segs = [] },
    moveTo(x, y) { segs.push(`M${+x.toFixed(2)} ${+y.toFixed(2)}`) },
    lineTo(x, y) { segs.push(`L${+x.toFixed(2)} ${+y.toFixed(2)}`) },
    rect(x, y, w, h) { segs.push(`M${+x.toFixed(2)} ${+y.toFixed(2)}h${+w.toFixed(2)}v${+h.toFixed(2)}h${-w.toFixed(2)}Z`) },
    stroke() { out.push(`<path d="${segs.join('')}" fill="none" stroke="${o.strokeStyle}" stroke-width="${o.lineWidth}"/>`) },
    fill() { out.push(`<path d="${segs.join('')}" fill="${o.fillStyle}"/>`) },
    out: () => out.join('')
  }
  return o
}
