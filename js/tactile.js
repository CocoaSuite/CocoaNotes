// Tactile mode: the pens live in a case at the edge of the screen.
// 1 Slide the case out. 2 Pick a pen. 3 Drag it onto the page. 4 Pop the cap off,
// and the pen is "grabbed": it fades into your hand and is ready to write.
// Every step has its own sound and haptic tick (see fx.js).
import { h } from './ui.js'
import { PENS, PEN_ORDER } from './ink.js'
import { settings, on as onStore } from './store.js'
import { choosePen, chooseTool, currentPen, currentTool, penInk } from './editor.js'
import { feedback, play, haptic } from './fx.js'

let root = null, panel = null, tab = null, well = null, stage = null
let open = false, held = null
const CAPPED = { ball: true, fountain: true, pencil: false, calli: true, marker: true, high: true }

const active = () => settings.ux === 'tactile'

// ---- the pens, drawn tall (viewBox 0 0 44 300, tip at the top)

function body(p, ink) {
  switch (p) {
    case 'ball': return `<path d="M18 40 L22 6 L26 40 Z" fill="#b9b9b6"/><circle cx="22" cy="7" r="2" fill="${ink}"/><rect x="15" y="38" width="14" height="250" rx="7" fill="#efefec"/><rect x="15" y="96" width="14" height="10" fill="${ink}"/><rect x="15" y="250" width="14" height="38" rx="7" fill="#dcdcd8"/>`
    case 'fountain': return `<path d="M16 48 C16 30 20 16 22 4 C24 16 28 30 28 48 Z" fill="#d7b25a"/><path d="M22 10 V34" stroke="#6b5420" stroke-width="1.2"/><circle cx="22" cy="34" r="2" fill="#6b5420"/><rect x="12" y="46" width="20" height="16" rx="3" fill="#262626"/><rect x="11" y="60" width="22" height="226" rx="11" fill="#232323"/><rect x="11" y="92" width="22" height="5" fill="#c9a24a"/><rect x="11" y="262" width="22" height="4" fill="#c9a24a"/>`
    case 'pencil': return `<path d="M13 52 L22 6 L31 52 Z" fill="#e8c39a"/><path d="M19.6 18 L22 6 L24.4 18 Z" fill="${ink}"/><path d="M13 52 L31 52 L31 258 L13 258 Z" fill="#e9b949"/><path d="M19 52 V258 M25 52 V258" stroke="#c99a2e" stroke-width="1.2"/><rect x="12" y="256" width="20" height="16" fill="#b8b8b2"/><path d="M12 262 H32 M12 267 H32" stroke="#8f8f8a"/><rect x="12" y="271" width="20" height="18" rx="5" fill="#f2a0a8"/>`
    case 'calli': return `<path d="M15 44 L16 10 L28 6 L29 44 Z" fill="#c9c9c4"/><path d="M16 10 L28 6" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><rect x="14" y="42" width="16" height="16" rx="2" fill="#9a9a95"/><rect x="12" y="56" width="20" height="232" rx="10" fill="#8a5a3a"/><path d="M14 80 Q22 74 30 80" stroke="#6d4429" stroke-width="2" fill="none"/>`
    case 'marker': return `<path d="M14 46 L17 16 Q22 6 27 16 L30 46 Z" fill="${ink}"/><rect x="9" y="44" width="26" height="244" rx="9" fill="#f3f3f0"/><rect x="9" y="120" width="26" height="40" fill="${ink}" opacity=".85"/><rect x="9" y="268" width="26" height="20" rx="9" fill="${ink}"/>`
    case 'high': return `<path d="M12 48 L12 18 L32 8 L32 48 Z" fill="${ink}"/><rect x="8" y="46" width="28" height="242" rx="8" fill="${ink}" opacity=".92"/><rect x="8" y="140" width="28" height="56" fill="#ffffff" opacity=".35"/>`
  }
}
function cap(p, ink) {
  switch (p) {
    case 'ball': return `<rect x="14" y="0" width="16" height="78" rx="8" fill="#e4e4e0"/><rect x="28" y="12" width="4" height="50" rx="2" fill="${ink}"/>`
    case 'fountain': return `<rect x="10" y="0" width="24" height="96" rx="12" fill="#1c1c1c"/><rect x="10" y="84" width="24" height="6" fill="#c9a24a"/><rect x="32" y="10" width="4" height="62" rx="2" fill="#c9a24a"/>`
    case 'calli': return `<rect x="11" y="0" width="22" height="66" rx="8" fill="#6d4429"/><rect x="11" y="56" width="22" height="5" fill="#c9c9c4"/>`
    case 'marker': return `<rect x="8" y="0" width="28" height="76" rx="10" fill="${ink}"/><rect x="33" y="10" width="5" height="44" rx="2.5" fill="${ink}"/>`
    case 'high': return `<rect x="7" y="0" width="30" height="72" rx="8" fill="${ink}" opacity=".95"/><rect x="7" y="58" width="30" height="6" fill="#fff" opacity=".4"/>`
    default: return ''
  }
}
const penSVG = (p, withCap = true) => {
  const ink = penInk(p)
  return `<svg class="bodyS" viewBox="0 0 44 300" aria-hidden="true">${body(p, ink)}</svg>` + (CAPPED[p] && withCap ? `<svg class="capS" viewBox="0 0 44 100" aria-hidden="true">${cap(p, ink)}</svg>` : '')
}

// ---- the case

export function initCase(st) {
  stage = st
  root = h('div', { class: 'case', hidden: true })
  tab = h('button', { class: 'caseTab', 'aria-label': 'Open the pen case' }, h('i'), h('i'), h('i'))
  well = h('div', { class: 'caseWell' })
  panel = h('div', { class: 'casePanel', role: 'dialog', 'aria-label': 'Pen case' }, well)
  root.append(panel, tab)
  stage.append(root)
  tabDrag()
  document.addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target) && !(held && held.el.contains(e.target))) slide(false) }, true)
  onStore((ev) => { if (ev === 'settings') caseSync() })
  caseSync()
}

export function caseSync() {
  if (!root) return
  root.hidden = !active()
  if (!active()) { if (held) dropHeld(); return }
  fill()
}

function fill() {
  const cur = currentPen()
  well.replaceChildren()
  const pens = h('div', { class: 'cPens' })
  for (const p of PEN_ORDER) {
    const inHand = cur === p || (held && held.p === p)
    const slot = h('button', { class: 'cSlot' + (inHand ? ' empty' : ''), 'aria-label': (inHand ? PENS[p].name + ' is in your hand' : 'Take the ' + PENS[p].name) })
    if (!inHand) { slot.innerHTML = `<span class="cPen">${penSVG(p)}</span>`; slot.addEventListener('pointerdown', (e) => pick(e, p, slot)) }
    pens.append(slot)
  }
  // The little blocks in the corner: text stamp, eraser and lasso.
  const block = (t, label, mark) => h('button', { class: 'cBlock' + (currentTool() === t ? ' on' : ''), 'aria-label': label, onclick: () => { chooseTool(t); feedback('tick'); slide(false) } }, h('span', { html: mark }))
  const blocks = h('div', { class: 'cBlocks' },
    block('text', 'Text tool', '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>'),
    block('eraser', 'Eraser', '<svg viewBox="0 0 24 24"><path d="M7 21 3 17 13 7l7 7-7 7zM8 12l7 7"/></svg>'),
    block('lasso', 'Lasso', '<svg viewBox="0 0 24 24"><path d="M12 4c5 0 8 2.5 8 5.5S16.5 15 12 15s-8-2.5-8-5.5S7 4 12 4zM7 14c-1 2 0 4 2 4s2 3 0 3"/></svg>'))
  well.append(pens, blocks)
}

function slide(v) {
  if (open === v) return
  open = v
  root.classList.toggle('open', v)
  panel.style.transform = ''
  if (v) fill()
  feedback(v ? 'slide' : 'slideBack', 'light')
  tab.setAttribute('aria-label', v ? 'Close the pen case' : 'Open the pen case')
}

/** Pull the tab: the case follows the finger, then settles open or shut. */
function tabDrag() {
  let d = null
  tab.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    tab.setPointerCapture(e.pointerId)
    d = { x: e.clientX, t: performance.now(), w: panel.offsetWidth + 24, dx: 0 }
    root.classList.add('drag')
  })
  tab.addEventListener('pointermove', (e) => {
    if (!d) return
    d.dx = Math.min(0, e.clientX - d.x)
    if (!open) panel.style.transform = `translateX(${Math.max(0, d.w + d.dx)}px)`
  })
  const end = () => {
    if (!d) return
    root.classList.remove('drag')
    const pulled = -d.dx, quick = performance.now() - d.t < 250 && pulled < 8
    panel.style.transform = ''
    if (quick) slide(!open)
    else slide(pulled > d.w * 0.3)
    d = null
  }
  tab.addEventListener('pointerup', end)
  tab.addEventListener('pointercancel', end)
}

// ---- taking a pen out

function pick(e, p, slot) {
  e.preventDefault()
  const r = slot.querySelector('.cPen').getBoundingClientRect()
  const sr = stage.getBoundingClientRect()
  const el = h('div', { class: 'held', html: penSVG(p) })
  el.style.width = r.width + 'px'; el.style.height = r.height + 'px'
  stage.append(el)
  slot.classList.add('empty'); slot.innerHTML = ''
  held = { p, el, x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2), rot: 0, sx: e.clientX, sy: e.clientY, capped: CAPPED[p], state: 'drag' }
  place()
  feedback('pick', 'light')
  el.setPointerCapture(e.pointerId)
  const move = (ev) => {
    held.x = ev.clientX - sr.left - held.ox; held.y = ev.clientY - sr.top - held.oy
    // Leaving the case, the pen tips over to the angle you would hold it at.
    const out = Math.max(0, Math.min(1, (panel.getBoundingClientRect().left - ev.clientX + 60) / 120))
    held.rot = -28 * out
    place()
  }
  const up = (ev) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
    const tapped = Math.hypot(ev.clientX - held.sx, ev.clientY - held.sy) < 8
    const inCase = ev.clientX > panel.getBoundingClientRect().left - 10 && open
    if (tapped || inCase) { held.x = sr.width * 0.42; held.y = sr.height * 0.5; held.rot = -28 }
    el.classList.add('settle')
    place()
    slide(false)
    setTimeout(() => el.classList.remove('settle'), 380)
    held.state = 'placed'
    if (held.capped) armCap()
    else setTimeout(() => grab(), 420)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

function place() {
  const { el, x, y, rot } = held
  el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight / 2}px) rotate(${rot}deg)`
}

/** The cap comes off with a flick or a tap. */
function armCap() {
  const c = held.el.querySelector('.capS')
  held.el.append(h('span', { class: 'capHint' }, 'Pop the cap off'))
  let s = null
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); c.setPointerCapture(e.pointerId); s = { x: e.clientX, y: e.clientY } })
  c.addEventListener('pointermove', (e) => {
    if (!s) return
    const d = Math.hypot(e.clientX - s.x, e.clientY - s.y)
    c.style.transform = `translateY(${-Math.min(14, d * 0.4)}px)`
    if (d > 26) { s = null; popCap(c) }
  })
  c.addEventListener('pointerup', () => { if (s) { s = null; popCap(c) } })
  // Tapping the pen itself also pops it, for one-handed use.
  held.el.querySelector('.bodyS').addEventListener('click', () => { if (held && held.capped) popCap(c) })
}

function popCap(c) {
  if (!held || !held.capped) return
  held.capped = false
  held.el.querySelector('.capHint')?.remove()
  feedback('cap', 'medium')
  c.classList.add('pop')
  setTimeout(() => grab(), 520)
}

/** The pen is taken in hand: it lifts, shrinks toward its tip and fades. */
function grab() {
  if (!held) return
  const { el, p } = held
  play('grab'); haptic('light')
  el.classList.add('grab')
  choosePen(p)
  setTimeout(() => { el.remove(); held = null; fill() }, 460)
}

function dropHeld() { held.el.remove(); held = null }
