// Small UI helpers shared by every screen: elements, icons, toasts, sheets and menus.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c))
  return el
}

export const $ = (s, r = document) => r.querySelector(s)
export const $$ = (s, r = document) => [...r.querySelectorAll(s)]

const P = {
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  inf: 'M7 9a3 3 0 1 0 0 6c3 0 7-6 10-6a3 3 0 1 1 0 6c-3 0-7-6-10-6z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  pages: 'M4 4h7v7H4zM4 13h7v7H4zM14 5h6M14 9h6M14 15h6M14 19h6',
  addPage: 'M6 3h9l4 4v14H6zM12.5 10v7M9 13.5h7',
  eraser: 'M7 21 3 17 13 7l7 7-7 7zM8 12l7 7M7 21h13',
  lasso: 'M12 4c5 0 8 2.5 8 5.5S16.5 15 12 15s-8-2.5-8-5.5S7 4 12 4zM7 14c-1 2 0 4 2 4s2 3 0 3',
  shapes: 'M3 11h9v9H3zM21 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  image: 'M3 4h18v16H3zM9 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM21 16l-5-5-9 9',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6 6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'm5 12 5 5 9-10',
  down: 'm6 9 6 6 6-6',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  dup: 'M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6',
  sync: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  device: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M10 5h9v9',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  paste: 'M9 4h6v3H9zM8 5H6v16h12V5h-2',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3',
  paper: 'M6 3h9l4 4v14H6zM9 11h7M9 15h7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  list: 'M4 6h16M4 12h10M4 18h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5a1.5 1.5 0 0 1 3 0v8M8 13l-1.5-1.5a1.6 1.6 0 0 0-2.3 2.2L9 19a5 5 0 0 0 4 2h1a5 5 0 0 0 5-5v-4'
}

export function icon(name, cls = 'i') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', P[name] || '')
  if (name === 'more') p.setAttribute('stroke-width', '3')
  s.append(p)
  return s
}

export function iconBtn(name, label, onclick, cls = 'ic') {
  return h('button', { class: cls, 'aria-label': label, title: label, onclick }, icon(name))
}

let toastT = 0
export function toast(msg, action) {
  const t = $('#toast')
  t.replaceChildren(h('span', {}, msg))
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('on'); action.run() } }, action.label))
  t.classList.add('on')
  clearTimeout(toastT)
  toastT = setTimeout(() => t.classList.remove('on'), action ? 7000 : 2800)
}

const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** Plays an entrance with the Web Animations API. The element is drawn in its final place from the
 *  very first frame (no class toggling a frame later), which is what stops the flicker on iPad. */
export function enter(el, from, ms = 220) {
  if (RM()) return
  el.animate([from, { opacity: 1, transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.22,.8,.24,1)' })
}

/** A dialog: centred on wide screens, a bottom sheet with a grab bar on phones (as in CocoaCanvas). */
export function sheet(title, body, { wide = false, onClose } = {}) {
  const m = $('#modal')
  const box = h('div', { class: 'box' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', esc)
    const phone = innerWidth <= 720
    const done = () => { if (m.firstChild === box) { m.hidden = true; m.replaceChildren() } }
    if (RM()) done()
    else {
      box.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: phone ? 'translateY(60px)' : 'translateY(10px) scale(.98)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' })
      m.animate([{ backgroundColor: 'rgba(0,0,0,.55)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 170, fill: 'forwards' }).finished.then(done, done)
    }
    onClose && onClose()
  }
  const esc = (e) => { if (e.key === 'Escape') close() }
  box.append(h('div', { class: 'grab' }), h('div', { class: 'mh' }, h('h2', {}, title), iconBtn('close', 'Close', close)), body)
  const wasOpen = !m.hidden && m.firstChild
  m.getAnimations().forEach(a => a.cancel())
  m.replaceChildren(box)
  m.hidden = false
  m.onpointerdown = (e) => { if (e.target === m) close() }
  if (!wasOpen && !RM()) m.animate([{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,.55)' }], { duration: 200 })
  enter(box, { opacity: 0, transform: innerWidth <= 720 ? 'translateY(70px)' : 'translateY(14px) scale(.98)' }, 260)
  document.addEventListener('keydown', esc)
  return { close, box }
}

/** A small menu or panel anchored to a button. Opening it again for the same button (or after the
 *  button was redrawn) updates it in place instead of closing and reopening it. */
let openPop = null
export function popover(anchor, content, { side = 'auto', cls = '' } = {}) {
  if (openPop && (openPop.anchor === anchor || !openPop.anchor.isConnected)) {
    openPop.pop.replaceChildren(content)
    openPop.pop.className = 'pop ' + cls
    openPop.anchor = anchor
    openPop.side = side
    openPop.place()
    return openPop.pop
  }
  closePop()
  const pop = h('div', { class: 'pop ' + cls, role: 'dialog' }, content)
  document.body.append(pop)
  const st = { pop, anchor, side }
  st.place = () => {
    const a = st.anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, M = 8
    let x, y
    const room = { below: innerHeight - a.bottom, above: a.top, right: innerWidth - a.right, left: a.left }
    let s = st.side
    if (s === 'auto') s = room.below > ph + 16 ? 'below' : room.above > ph + 16 ? 'above' : room.right > pw + 16 ? 'right' : 'left'
    if (s === 'below') { x = a.left + a.width / 2 - pw / 2; y = a.bottom + 8 }
    else if (s === 'above') { x = a.left + a.width / 2 - pw / 2; y = a.top - ph - 10 }
    else if (s === 'right') { x = a.right + 10; y = a.top + a.height / 2 - ph / 2 }
    else { x = a.left - pw - 10; y = a.top + a.height / 2 - ph / 2 }
    pop.style.left = Math.max(M, Math.min(innerWidth - pw - M, x)) + 'px'
    pop.style.top = Math.max(M + (window.visualViewport?.offsetTop || 0), Math.min(innerHeight - ph - M, y)) + 'px'
    st.s = s
  }
  st.place()
  const o = { below: 'translateY(-6px)', above: 'translateY(6px)', right: 'translateX(-6px)', left: 'translateX(6px)' }[st.s] || 'none'
  enter(pop, { opacity: 0, transform: o + ' scale(.97)' }, 160)
  st.away = (e) => { if (!pop.contains(e.target) && !st.anchor.contains(e.target)) closePop() }
  setTimeout(() => document.addEventListener('pointerdown', st.away, true), 0)
  st.esc = (e) => { if (e.key === 'Escape') closePop() }
  document.addEventListener('keydown', st.esc)
  openPop = st
  return pop
}
export function closePop() {
  if (!openPop) return
  const { pop, away, esc } = openPop
  document.removeEventListener('pointerdown', away, true)
  document.removeEventListener('keydown', esc)
  openPop = null
  if (RM()) { pop.remove(); return }
  pop.style.pointerEvents = 'none'
  pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }).finished.then(() => pop.remove(), () => pop.remove())
}
export const popOpenFor = (a) => openPop && openPop.anchor === a
export const replacePop = () => openPop && openPop.place()

export function menu(anchor, items, opts) {
  const list = h('div', { class: 'menu' })
  for (const it of items) {
    if (!it) continue
    if (it === '-') { list.append(h('hr')); continue }
    if (it.label && it.header) { list.append(h('div', { class: 'lbl' }, it.label)); continue }
    list.append(h('button', { class: it.danger ? 'danger' : '', onclick: () => { closePop(); it.run() } }, it.icon ? icon(it.icon) : null, h('span', {}, it.label)))
  }
  return popover(anchor, list, opts)
}

export function confirmSheet(title, text, okLabel, { danger = false } = {}) {
  return new Promise(res => {
    let done = false
    const body = h('div', { class: 'sb' }, h('p', { class: 'mute' }, text))
    const s = sheet(title, body, { onClose: () => { if (!done) res(false) } })
    body.append(h('div', { class: 'row end' },
      h('button', { onclick: () => s.close() }, 'Cancel'),
      h('button', { class: danger ? 'pri dangerBg' : 'pri', onclick: () => { done = true; res(true); s.close() } }, okLabel)))
  })
}

export function promptSheet(title, value, okLabel = 'Save') {
  return new Promise(res => {
    let done = false
    const inp = h('input', { type: 'text', value: value || '', 'aria-label': title })
    const body = h('form', { class: 'sb', onsubmit: (e) => { e.preventDefault(); done = true; res(inp.value.trim()); s.close() } }, inp,
      h('div', { class: 'row end' }, h('button', { type: 'button', onclick: () => s.close() }, 'Cancel'), h('button', { class: 'pri', type: 'submit' }, okLabel)))
    const s = sheet(title, body, { onClose: () => { if (!done) res(null) } })
    setTimeout(() => { inp.focus(); inp.select() }, 60)
  })
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago'
  return new Date(t).toLocaleDateString()
}

/** The pen as it sits in the tray: a small shaded illustration, tip up. */
let gid = 0
export function penSVG(pen, ink) {
  const id = 'pg' + (++gid)
  // Horizontal shading that makes a flat shape read as a round barrel.
  const barrel = (k, a, b, c) => `<linearGradient id="${id}${k}" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset=".38" stop-color="${b}"/><stop offset=".72" stop-color="${a}"/><stop offset="1" stop-color="${c}"/></linearGradient>`
  const defs = `<defs>${barrel('w', '#dcdcd7', '#fbfbf8', '#a9a9a4')}${barrel('m', '#9a9a95', '#ecece8', '#6f6f6a')}${barrel('g', '#b8913b', '#f3d98e', '#8a6a24')}${barrel('k', '#1a1a1a', '#4a4a4a', '#0b0b0b')}${barrel('y', '#e2ab2c', '#ffd567', '#b98516')}${barrel('b', '#7b4a2c', '#b77a50', '#5a341d')}</defs>`
  const body = (x, w, fill, y = 24) => `<rect x="${x}" y="${y}" width="${w}" height="${66 - y}" rx="${w / 2.4}" fill="url(#${id}${fill})"/>`
  const band = (x, w, y = 31) => `<rect x="${x}" y="${y}" width="${w}" height="4" fill="${ink}"/><rect x="${x}" y="${y}" width="${w}" height="1.2" fill="#fff" opacity=".35"/>`
  const parts = {
    ball: body(7.5, 11, 'w') + band(7.5, 11) + `<path d="M8 25 L11.6 9 Q13 6.5 14.4 9 L18 25 Z" fill="url(#${id}m)"/><circle cx="13" cy="7.2" r="1.5" fill="${ink}"/>`,
    fountain: body(7, 12, 'k', 27) + `<rect x="7" y="34" width="12" height="2.2" fill="url(#${id}g)"/><rect x="8" y="21" width="10" height="7" rx="1.5" fill="url(#${id}k)"/><path d="M8.6 22 C 8.6 14 11.5 7 13 3 C 14.5 7 17.4 14 17.4 22 Z" fill="url(#${id}g)"/><path d="M13 6 V15.5" stroke="#5a4517" stroke-width=".9"/><circle cx="13" cy="15.8" r="1.1" fill="#5a4517"/>`,
    pencil: `<path d="M7 26 L7 66 L19 66 L19 26 Z" fill="url(#${id}y)"/><path d="M11 26 V66 M15 26 V66" stroke="#b98516" stroke-width=".6" opacity=".7"/><path d="M7 26.5 L13 6 L19 26.5 Q16 25 13 26.5 Q10 25 7 26.5 Z" fill="#ecd0a8"/><path d="M11.2 12.2 L13 6 L14.8 12.2 Q13 11.4 11.2 12.2 Z" fill="${ink}"/>`,
    calli: body(7.5, 11, 'b', 26) + `<rect x="8" y="21" width="10" height="6" rx="1" fill="url(#${id}m)"/><path d="M8.5 22 L9 9 L17 6 L17.5 22 Z" fill="url(#${id}m)"/><path d="M9 9 L17 6" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
    marker: body(5.5, 15, 'w', 25) + band(5.5, 15, 33) + `<path d="M7 26 L9.5 13 Q13 8.5 16.5 13 L19 26 Z" fill="${ink}"/><path d="M10 15 Q12 11 13 11" stroke="#fff" stroke-width="1" opacity=".35" fill="none"/>`,
    high: `<rect x="5" y="25" width="16" height="41" rx="5" fill="${ink}"/><rect x="5" y="25" width="16" height="41" rx="5" fill="url(#${id}w)" opacity=".45"/><path d="M7 26 L7 12 L19 7 L19 26 Z" fill="${ink}"/><path d="M7 12 L19 7" stroke="#fff" stroke-width=".8" opacity=".5"/>`
  }
  return `<svg viewBox="0 0 26 64" aria-hidden="true">${defs}${parts[pen]}</svg>`
}
