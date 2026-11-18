// Compact storage for ink. A point is kept as the step from the previous point in 1/32 px units
// (two 16-bit numbers) plus its width factor in one byte: 5 bytes instead of ~30 as JSON numbers.
// A long stroke of 300 points is about 1.5 KB. The format is lossless at the precision ink needs.

const Q = 32           // position steps per page pixel
const FQ = 64          // width factor steps (factor 0..~4)

/** pts [x,y,f, x,y,f, ...] → Uint8Array */
export function encodePts(pts) {
  const n = pts.length / 3
  let small = true
  for (let i = 1; i < n && small; i++) {
    const dx = Math.round(pts[i * 3] * Q) - Math.round(pts[i * 3 - 3] * Q), dy = Math.round(pts[i * 3 + 1] * Q) - Math.round(pts[i * 3 - 2] * Q)
    if (dx < -32768 || dx > 32767 || dy < -32768 || dy > 32767) small = false
  }
  if (small) {
    // [1][x0 f32][y0 f32] then per point: dx i16, dy i16, f u8 (first point has dx=dy=0)
    const buf = new ArrayBuffer(9 + n * 5), v = new DataView(buf)
    v.setUint8(0, 1)
    v.setFloat32(1, Math.round(pts[0] * Q) / Q, true); v.setFloat32(5, Math.round(pts[1] * Q) / Q, true)
    let px = Math.round(pts[0] * Q), py = Math.round(pts[1] * Q), o = 9
    for (let i = 0; i < n; i++) {
      const qx = Math.round(pts[i * 3] * Q), qy = Math.round(pts[i * 3 + 1] * Q)
      v.setInt16(o, qx - px, true); v.setInt16(o + 2, qy - py, true)
      v.setUint8(o + 4, Math.max(0, Math.min(255, Math.round(pts[i * 3 + 2] * FQ))))
      px = qx; py = qy; o += 5
    }
    return new Uint8Array(buf)
  }
  // Rare: very long straight jumps (a shape across a huge canvas). Plain floats.
  const buf = new ArrayBuffer(1 + n * 9), v = new DataView(buf)
  v.setUint8(0, 2)
  for (let i = 0, o = 1; i < n; i++, o += 9) { v.setFloat32(o, pts[i * 3], true); v.setFloat32(o + 4, pts[i * 3 + 1], true); v.setUint8(o + 8, Math.max(0, Math.min(255, Math.round(pts[i * 3 + 2] * FQ)))) }
  return new Uint8Array(buf)
}

export function decodePts(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const kind = v.getUint8(0), out = []
  const r = (x) => Math.round(x * 1000) / 1000
  if (kind === 1) {
    const n = (u8.byteLength - 9) / 5
    let qx = Math.round(v.getFloat32(1, true) * Q), qy = Math.round(v.getFloat32(5, true) * Q)
    for (let i = 0, o = 9; i < n; i++, o += 5) {
      qx += v.getInt16(o, true); qy += v.getInt16(o + 2, true)
      out.push(r(qx / Q), r(qy / Q), v.getUint8(o + 4) / FQ)
    }
  } else {
    const n = (u8.byteLength - 1) / 9
    for (let i = 0, o = 1; i < n; i++, o += 9) out.push(r(v.getFloat32(o, true)), r(v.getFloat32(o + 4, true)), v.getUint8(o + 8) / FQ)
  }
  return out
}

/** Items as kept on the device: strokes carry binary points; caches are dropped. */
export function packItems(items) {
  return items.map(it => {
    const o = {}
    for (const k in it) if (k[0] !== '_' && k !== 'pts') o[k] = it[k]
    if (it.t === 's') o.p = encodePts(it.pts)
    return o
  })
}
export function unpackItems(items) {
  return (items || []).map(it => {
    if (it.t !== 's' || it.pts) return it
    const o = { ...it, pts: decodePts(it.p instanceof Uint8Array ? it.p : new Uint8Array(it.p)) }
    delete o.p
    return o
  })
}

// Base64 for the cloud and backup files, which are JSON.
export function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s) }
export function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u }

/** Items for a JSON file: binary points as base64 text. */
export function itemsToJSON(items) { return packItems(items).map(o => (o.p ? { ...o, p: b64(o.p) } : o)) }
export function itemsFromJSON(items) { return unpackItems((items || []).map(o => (typeof o.p === 'string' ? { ...o, p: unb64(o.p) } : o))) }

/** Size in bytes of a page as stored, for the storage panel. */
export function packedSize(items) {
  let n = 0
  for (const o of packItems(items)) { n += 60; if (o.p) n += o.p.byteLength; if (o.text) n += o.text.length * 2 }
  return n
}
