// Vector ink. A stroke is kept as its input points (x, y, width factor) and turned into a filled
// outline path. The outline is plain path data, so it draws sharp at any zoom, prints as vectors
// and exports straight to SVG.

export const PENS = {
  ball: { name: 'Ballpoint', w: 2.2, sizes: [1.2, 2.2, 3.6], smooth: 0.42 },
  fountain: { name: 'Fountain pen', w: 2.8, sizes: [1.6, 2.8, 4.6], smooth: 0.5 },
  pencil: { name: 'Pencil', w: 2.2, sizes: [1.4, 2.2, 3.4], smooth: 0.35 },
  calli: { name: 'Calligraphy', w: 7, sizes: [4, 7, 12], smooth: 0.55 },
  marker: { name: 'Marker', w: 6, sizes: [4, 6, 10], smooth: 0.5 },
  high: { name: 'Highlighter', w: 18, sizes: [12, 18, 26], smooth: 0.6 }
}
export const PEN_ORDER = ['ball', 'fountain', 'pencil', 'calli', 'marker', 'high']

const r2 = (n) => Math.round(n * 100) / 100

/** Width factor for one input sample, from pressure, tilt and speed. */
export function sampleFactor(pen, e, dist) {
  const isPen = e.pointerType === 'pen'
  let p = isPen ? (e.pressure || 0.5) : 0.5
  if (isPen && p === 0) p = 0.5
  switch (pen) {
    case 'ball': return 0.88 + 0.24 * p
    case 'fountain': {
      const speed = Math.min(1, dist / 14)
      return (0.35 + 1.15 * p) * (1.08 - 0.4 * speed)
    }
    case 'pencil': {
      let f = 0.7 + 0.6 * p
      // Leaning the pencil shades wider, as on paper.
      let alt = e.altitudeAngle
      if (alt === undefined && (e.tiltX || e.tiltY)) {
        const t = Math.min(Math.PI / 2, Math.hypot(e.tiltX || 0, e.tiltY || 0) * Math.PI / 180)
        alt = Math.PI / 2 - t
      }
      if (isPen && alt !== undefined && alt < 1.2) f *= 1 + (1.2 - alt) * 2.6
      return f
    }
    case 'calli': return 0.55 + 0.75 * p
    case 'marker': return 0.94 + 0.12 * p
    default: return 1
  }
}

export function bbox(item) {
  if (item._b) return item._b
  if (item.t === 's') {
    const P = item.pts, pad = item.w * 3 + 2
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1]; if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y }
    return (item._b = [a - pad, b - pad, c + pad, d + pad])
  }
  return (item._b = [item.x, item.y, item.x + item.w, item.y + item.h])
}

/** Highlighter strokes that are nearly straight snap to a clean line. */
export function maybeStraighten(item) {
  if (item.pen !== 'high' && !item.snap) return
  const P = item.pts, n = P.length / 3
  if (n < 4) return
  const x0 = P[0], y0 = P[1], x1 = P[P.length - 3], y1 = P[P.length - 2]
  const L = Math.hypot(x1 - x0, y1 - y0)
  if (L < 40) return
  let dev = 0
  for (let i = 0; i < P.length; i += 3) dev = Math.max(dev, Math.abs((x1 - x0) * (y0 - P[i + 1]) - (x0 - P[i]) * (y1 - y0)) / L)
  if (dev < Math.max(5, L * 0.06)) item.pts = [x0, y0, 1, x1, y1, 1]
}

/** Builds the outline path data for a stroke, cached on the item. */
export function strokePath(item) {
  if (item._d) return item._d
  const base = item.w, P = item.pts, n = P.length / 3
  let d
  if (n === 1 || (n === 2 && P[0] === P[3] && P[1] === P[4])) {
    const r = Math.max(0.6, base * P[2] * (item.pen === 'calli' ? 0.35 : 0.5))
    d = dot(P[0], P[1], r)
  } else if (item.pen === 'calli') d = nibPath(item)
  else d = ribbonPath(item)
  item._d = d
  return d
}

export function path2d(item) {
  if (!item._p) item._p = new Path2D(strokePath(item))
  return item._p
}

const dot = (x, y, r) => `M${r2(x - r)} ${r2(y)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`

/** Variable-width ribbon with round ends. */
function ribbonPath(item) {
  const P = item.pts, n = P.length / 3, base = item.w
  const flat = item.pen === 'high'
  // Smooth the width factors so pressure jitter does not show.
  const W = new Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { s += P[j * 3 + 2]; c++ } }
    W[i] = Math.max(0.35, (s / c) * base) / 2
  }
  // Fountain strokes taper in and out.
  if (item.pen === 'fountain') {
    const T = Math.min(5, Math.floor(n / 3))
    for (let i = 0; i < T; i++) { const f = 0.45 + 0.55 * (i / T); W[i] *= f; W[n - 1 - i] *= f }
  }
  const L = [], R = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1]
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    const nx = -dy * W[i], ny = dx * W[i]
    const x = P[i * 3], y = P[i * 3 + 1]
    L.push([x + nx, y + ny]); R.push([x - nx, y - ny])
  }
  let d = `M${r2(L[0][0])} ${r2(L[0][1])}`
  d += curve(L)
  const rE = W[n - 1]
  d += flat ? `L${r2(R[n - 1][0])} ${r2(R[n - 1][1])}` : `A${r2(rE)} ${r2(rE)} 0 0 1 ${r2(R[n - 1][0])} ${r2(R[n - 1][1])}`
  d += curve(R.reverse())
  const rS = W[0]
  d += flat ? 'Z' : `A${r2(rS)} ${r2(rS)} 0 0 1 ${r2(L[0][0])} ${r2(L[0][1])}Z`
  return d
}

/** Quadratic curves through midpoints, starting from the current point (pts[0]). */
function curve(pts) {
  if (pts.length < 3) return pts.slice(1).map(p => `L${r2(p[0])} ${r2(p[1])}`).join('')
  let s = ''
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2
    s += `Q${r2(pts[i][0])} ${r2(pts[i][1])} ${r2(mx)} ${r2(my)}`
  }
  const l = pts[pts.length - 1]
  return s + `L${r2(l[0])} ${r2(l[1])}`
}

/** Broad-nib calligraphy: the nib is a flat edge held at a fixed angle, so the line is thick
 *  across the nib and thin along it. Built from consistently wound quads, filled nonzero. */
function nibPath(item) {
  const P = item.pts, n = P.length / 3
  const ang = ((item.nib ?? 40) * Math.PI) / 180
  const vx = Math.cos(ang), vy = -Math.sin(ang)
  const hair = Math.max(0.5, item.w * 0.09)
  let d = ''
  const quad = (q) => {
    // Same winding for every piece, so overlaps never cancel out.
    let A = 0
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; A += a[0] * b[1] - b[0] * a[1] }
    if (A < 0) q.reverse()
    d += `M${r2(q[0][0])} ${r2(q[0][1])}L${r2(q[1][0])} ${r2(q[1][1])}L${r2(q[2][0])} ${r2(q[2][1])}L${r2(q[3][0])} ${r2(q[3][1])}Z`
  }
  for (let i = 0; i < n - 1; i++) {
    const ax = P[i * 3], ay = P[i * 3 + 1], bx = P[i * 3 + 3], by = P[i * 3 + 4]
    const ha = (item.w * P[i * 3 + 2]) / 2, hb = (item.w * P[i * 3 + 5]) / 2
    quad([[ax + vx * ha, ay + vy * ha], [bx + vx * hb, by + vy * hb], [bx - vx * hb, by - vy * hb], [ax - vx * ha, ay - vy * ha]])
    // A hairline so strokes along the nib never vanish.
    let sx = bx - ax, sy = by - ay
    const sl = Math.hypot(sx, sy) || 1
    const nx = (-sy / sl) * hair, ny = (sx / sl) * hair
    quad([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]])
  }
  return d
}

/** Distance from point to segment. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Does a circle at (x, y) with radius r touch the stroke? */
export function hitStroke(item, x, y, r) {
  const b = bbox(item)
  if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false
  const P = item.pts, lim = r + item.w / 2
  if (P.length === 3) return Math.hypot(P[0] - x, P[1] - y) <= lim
  for (let i = 0; i < P.length - 3; i += 3) if (segDist(x, y, P[i], P[i + 1], P[i + 3], P[i + 4]) <= lim) return true
  return false
}

export function pointInPoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Item inside a lasso: most of a stroke's points, or the centre of a box. */
export function inLasso(item, poly) {
  if (item.t === 's') {
    const P = item.pts
    let c = 0
    for (let i = 0; i < P.length; i += 3) if (pointInPoly(P[i], P[i + 1], poly)) c++
    return c / (P.length / 3) >= 0.5
  }
  return pointInPoly(item.x + item.w / 2, item.y + item.h / 2, poly)
}

/** Points for a shape drawn from a to b. */
export function shapePoints(kind, ax, ay, bx, by) {
  const pts = []
  const add = (x, y) => pts.push(r2(x), r2(y), 1)
  if (kind === 'line' || kind === 'arrow') {
    add(ax, ay); add(bx, by)
    return [pts]
  }
  if (kind === 'rect') {
    const out = []
    for (const [x0, y0, x1, y1] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]]) out.push([r2(x0), r2(y0), 1, r2(x1), r2(y1), 1])
    return out
  }
  // ellipse
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2
  const N = Math.max(24, Math.min(160, Math.round((rx + ry) / 3)))
  for (let i = 0; i <= N; i++) { const t = (i / N) * Math.PI * 2; add(cx + rx * Math.cos(t), cy + ry * Math.sin(t)) }
  return [pts]
}

export function arrowHead(ax, ay, bx, by, w) {
  const a = Math.atan2(by - ay, bx - ax), L = Math.max(12, w * 5)
  const p = (ang) => [r2(bx - L * Math.cos(a + ang)), r2(by - L * Math.sin(a + ang)), 1, r2(bx), r2(by), 1]
  return [p(0.45), p(-0.45)]
}

export function moveItem(it, dx, dy) {
  if (it.t === 's') { for (let i = 0; i < it.pts.length; i += 3) { it.pts[i] = r2(it.pts[i] + dx); it.pts[i + 1] = r2(it.pts[i + 1] + dy) } }
  else { it.x += dx; it.y += dy }
  invalidate(it)
}

export function scaleItem(it, ox, oy, k) {
  if (it.t === 's') {
    for (let i = 0; i < it.pts.length; i += 3) { it.pts[i] = r2(ox + (it.pts[i] - ox) * k); it.pts[i + 1] = r2(oy + (it.pts[i + 1] - oy) * k) }
    it.w = r2(it.w * k)
  } else {
    it.x = ox + (it.x - ox) * k; it.y = oy + (it.y - oy) * k; it.w *= k; it.h *= k
    if (it.t === 't') it.s = r2(it.s * k)
  }
  invalidate(it)
}

export function invalidate(it) { delete it._b; delete it._d; delete it._p; delete it._lines }
