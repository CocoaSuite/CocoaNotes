// The CocoaSuite Hello: "hello" is written in one stroke over the blurred app with the hello sound,
// then a few cards set CocoaNotes up the way you write. Same lettering as CocoaShot and CocoaCanvas.
import { h } from './ui.js'
import { settings, saveSettings } from './store.js'
import { PROVIDERS } from './sync.js'
import { feedback, unlock } from './fx.js'

const HELLO = {
  en: { vb: '0 0 360 180', d: 'M14 132 C 34 112, 64 60, 64 34 C 64 14, 46 14, 41 38 C 36 68, 36 116, 34 148 C 41 114, 56 94, 74 94 C 91 94, 91 114, 89 134 C 88 149, 96 151, 108 144 C 121 137, 141 124, 141 109 C 141 97, 124 97, 118 111 C 111 129, 121 151, 141 149 C 161 147, 176 129, 186 109 C 201 79, 211 44, 206 29 C 201 17, 186 24, 184 54 C 182 89, 184 129, 196 147 C 206 157, 221 144, 231 124 C 246 89, 254 49, 248 29 C 242 17, 228 24, 227 54 C 225 89, 227 129, 239 147 C 249 157, 264 147, 274 131 C 281 111, 296 99, 311 101 C 331 104, 331 144, 308 149 C 288 153, 281 127, 296 109 C 304 101, 318 99, 334 104' },
  ru: { vb: '0 0 450 210', d: 'M10 142 C 18 124, 26 106, 32 96 C 31 116, 29 134, 28 150 C 33 122, 44 96, 58 96 C 72 96, 70 122, 69 150 C 74 132, 84 112, 94 96 C 93 130, 91 165, 89 192 C 88 160, 91 122, 101 106 C 111 94, 128 96, 128 116 C 128 140, 106 150, 96 138 C 108 146, 124 136, 134 116 C 137 108, 139 101, 141 96 C 139 120, 135 150, 151 150 C 167 150, 177 120, 183 96 C 181 120, 177 150, 193 150 C 203 150, 210 138, 216 122 C 222 102, 232 64, 228 44 C 224 26, 206 34, 208 64 C 210 94, 212 124, 216 146 C 222 156, 244 154, 248 136 C 251 122, 240 116, 228 120 C 244 114, 252 104, 248 94 C 244 84, 226 92, 218 104 C 232 128, 250 134, 264 128 C 282 122, 290 110, 288 102 C 286 92, 268 94, 263 110 C 257 128, 266 150, 284 150 C 298 150, 306 136, 312 120 C 316 108, 320 100, 324 96 C 322 118, 320 136, 319 150 C 323 122, 332 96, 344 96 C 356 96, 356 122, 354 150 C 358 122, 368 96, 380 96 C 392 96, 392 122, 390 150 C 394 152, 404 146, 412 132' }
}
const A = '#F5913E'
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms) => new Promise(r => setTimeout(r, RM() ? 0 : ms))

const ILL = {
  books: `<g class="oLift"><rect x="44" y="18" width="62" height="86" rx="5" fill="#f4f2ec"/><rect x="44" y="18" width="8" height="86" fill="${A}"/>${[0, 1, 2, 3, 4, 5].map(i => `<path d="M58 ${34 + i * 11}h40" stroke="#c9d3e0" stroke-width="1.5"/>`).join('')}<path d="M60 44c8-6 14 4 22-2s12 2 16-2" fill="none" stroke="#23324d" stroke-width="2" stroke-linecap="round" class="oInk"/></g><g class="oLift" style="animation-delay:.5s"><rect x="126" y="18" width="80" height="86" rx="5" fill="#f4f2ec"/>${Array.from({ length: 30 }, (_, i) => `<circle cx="${134 + (i % 6) * 13}" cy="${28 + Math.floor(i / 6) * 16}" r="1.2" fill="#aab5c4"/>`).join('')}<ellipse cx="160" cy="50" rx="20" ry="11" fill="none" stroke="#23324d" stroke-width="2"/><path d="M175 58l14 18" stroke="${A}" stroke-width="2" stroke-linecap="round"/></g>`,
  pen: `<rect x="40" y="16" width="160" height="88" rx="10" fill="#f4f2ec"/><path class="oInk" d="M60 70c14-30 26-30 34-8s20 22 30 0 24-20 40 2" fill="none" stroke="#23324d" stroke-width="3" stroke-linecap="round"/><g class="oNib"><path d="M150 40l30-24 8 8-30 24-11 3z" fill="#2b2b2b"/><path d="M147 51l3-11 8 8z" fill="#c9a24a"/></g><g class="oFing"><circle cx="96" cy="96" r="9" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="2"/><circle cx="122" cy="96" r="9" fill="rgba(255,255,255,.2)" stroke="#fff" stroke-width="2"/></g>`,
  hand: `<rect x="34" y="14" width="172" height="92" rx="12" fill="#1c1c1c" stroke="#444"/><rect x="48" y="24" width="144" height="58" rx="4" fill="#f4f2ec"/><rect class="oTray" x="82" y="88" width="76" height="12" rx="6" fill="${A}"/>`,
  case: `<rect x="34" y="12" width="120" height="96" rx="6" fill="#f4f2ec"/><g class="oCase"><rect x="130" y="14" width="80" height="92" rx="16" fill="#0d0d0d"/><rect x="138" y="22" width="64" height="76" rx="10" fill="#d6d6d2"/><rect x="148" y="28" width="7" height="64" rx="3.5" fill="#232323"/><rect x="160" y="28" width="7" height="64" rx="3.5" fill="#e9b949"/><rect x="172" y="28" width="7" height="64" rx="3.5" fill="#8a5a3a"/><rect x="184" y="70" width="12" height="12" rx="2" fill="#fff" stroke="#999"/></g>`,
  cloud: `<g class="oUp"><path d="M86 74h68a22 22 0 0 0 3-44 34 34 0 0 0-65 8 20 20 0 0 0-6 36z" fill="none" stroke="${A}" stroke-width="4" stroke-linejoin="round"/><path d="M120 86V50M108 62l12-12 12 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><rect x="96" y="96" width="48" height="14" rx="4" fill="#2a2a2a" stroke="#555"/><circle cx="104" cy="103" r="3" fill="#5b9f74"/>`
}

let running = false

export function hello({ force = false, onDone } = {}) {
  if (running || (!force && settings.onboarded)) return
  running = true
  const lang = (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en'
  const W = HELLO[lang]
  const choice = { ux: settings.ux || 'classic', penOnly: settings.penOnly, tray: settings.tray || 'bottom' }
  const STEPS = [
    { ill: 'books', title: 'Two kinds of notebooks', text: 'Journals are A4 pages you flip through, vertical or horizontal, with the lining you like. Canvases have no edges at all.' },
    { ill: 'pen', title: 'The pen writes, fingers move', text: 'Pinch to zoom and scroll with two fingers. Tap with two fingers to undo. How will you write?', pick: ['penOnly', [['auto', 'Stylus'], [false, 'Finger']]] },
    { ill: 'hand', title: 'Which hand do you write with?', text: 'The pen tray moves out from under your hand.', pick: ['tray', [['bottom', 'Bottom'], ['right', 'Left hand'], ['left', 'Right hand']]], note: 'tray' },
    { ill: 'case', title: 'Classic or tactile', text: 'Tactile keeps your pens in a case: slide it out, pick a pen, pop the cap. With pen-on-paper sounds.', pick: ['ux', [['classic', 'Classic'], ['tactile', 'Tactile']]] },
    { ill: 'cloud', title: 'Nothing gets lost', text: 'Every stroke is saved on this device first. Connect a cloud and copies upload by themselves, retrying until they arrive.', cloud: true }
  ]
  const O = h('div', { id: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to CocoaNotes' })
  O.innerHTML = `<div class="onbH"><svg viewBox="${W.vb}" aria-hidden="true"><path d="${W.d}"/></svg><div class="onbTap">Tap anywhere</div></div>
    <div class="onbC" hidden><div class="onbS"><div class="onbIll"><svg viewBox="0 0 240 120"></svg></div><h3></h3><p></p><div class="onbSt"></div></div><div class="onbD">${STEPS.map(() => '<i></i>').join('')}</div><div class="onbR"><button class="onbSk">Skip</button><span class="sp"></span><button class="onbBk">Back</button><button class="pri onbNx"></button></div></div>`
  document.body.append(O)
  const H = O.querySelector('.onbH'), P = H.querySelector('path'), C = O.querySelector('.onbC'), SS = C.querySelector('.onbS'), ST = C.querySelector('.onbSt'), tap = H.querySelector('.onbTap')
  const au = new Audio('sounds/hello.mp3'); au.volume = 0.85; au.preload = 'auto'
  const len = P.getTotalLength()
  P.style.strokeDasharray = String(len)
  P.style.strokeDashoffset = String(RM() ? 0 : len)
  requestAnimationFrame(() => requestAnimationFrame(() => O.classList.add('on')))
  let phase = -1, i = 0
  const write = (snd) => {
    if (phase !== -1) return
    phase = 0
    tap.classList.remove('on')
    if (snd) { try { au.currentTime = 0; au.play()?.catch(() => { }) } catch { } }
    P.style.transition = RM() ? '' : `stroke-dashoffset 2.9s cubic-bezier(.55,.1,.35,1) ${snd ? '.12s' : '.45s'}`
    P.style.strokeDashoffset = '0'
    setTimeout(() => { if (phase === 0) tap.classList.add('on') }, RM() ? 0 : 3200)
  }
  // Browsers only play sound after a tap; try straight away, else write silently and offer the tap.
  setTimeout(() => {
    let pr
    try { pr = au.play() } catch { }
    if (pr?.then) { let ok = false; pr.then(() => { if (phase !== -1) { au.pause(); return } ok = true; write(false) }).catch(() => write(false)); setTimeout(() => { if (!ok) write(false) }, 250) }
    else write(false)
  }, 450)

  const show = (n, dir) => {
    const st = STEPS[n]
    const fill = () => {
      SS.querySelector('svg').innerHTML = ILL[st.ill]
      SS.querySelector('h3').textContent = st.title
      SS.querySelector('p').textContent = st.text
      ST.replaceChildren()
      ST.hidden = !st.pick && !st.cloud
      if (st.pick) {
        const [key, opts] = st.pick
        for (const [v, label] of opts) {
          const b = h('button', { class: choice[key] === v || (key === 'penOnly' && v === 'auto' && choice[key] !== false) ? 'on' : '', onclick: () => { choice[key] = v; ST.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); feedback(key === 'ux' && v === 'tactile' ? 'slide' : 'tick') } }, label)
          ST.append(b)
        }
      }
      if (st.cloud) {
        for (const p of Object.values(PROVIDERS)) ST.append(h('button', { class: p.connected() ? 'on' : '', onclick: async () => { try { await p.connect(false) } catch (e) { ST.append(h('div', { class: 'onbErr' }, e.message)) } } }, p.connected() ? p.name + ' connected' : 'Connect ' + p.name))
        ST.append(h('div', { class: 'onbNote' }, 'You can connect later in Settings.'))
      }
      C.querySelectorAll('.onbD i').forEach((d, k) => d.classList.toggle('on', k === n))
      C.querySelector('.onbBk').style.visibility = n ? 'visible' : 'hidden'
      C.querySelector('.onbNx').textContent = n === STEPS.length - 1 ? 'Start writing' : 'Next'
    }
    if (dir === 0 || RM()) { fill(); i = n; return }
    SS.style.setProperty('--sx', (dir > 0 ? -18 : 18) + 'px')
    SS.classList.add('sw')
    setTimeout(() => { fill(); SS.style.setProperty('--sx', (dir > 0 ? 18 : -18) + 'px'); SS.style.transition = 'none'; void SS.offsetWidth; SS.style.transition = ''; SS.classList.remove('sw') }, 200)
    i = n
  }
  const toCard = async () => {
    if (phase === 1 || phase === 2) return
    if (phase === -1) write(true)
    phase = 1
    unlock()
    H.classList.add('out')
    await wait(380)
    H.remove()
    C.hidden = false
    show(0, 0)
    void C.offsetWidth
    C.classList.add('in')
    setTimeout(() => C.querySelector('.onbNx').focus(), 300)
  }
  const finish = async () => {
    if (phase === 2) return
    phase = 2
    settings.ux = choice.ux; settings.tray = choice.tray; settings.penOnly = choice.penOnly; settings.onboarded = true
    saveSettings()
    C.classList.remove('in'); C.classList.add('out')
    await wait(300)
    O.classList.add('clear')
    await wait(900)
    O.remove()
    running = false
    onDone && onDone()
  }
  H.addEventListener('click', () => { if (phase === 0) toCard(); else if (phase === -1) { write(true) } })
  O.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish() })
  document.addEventListener('keydown', function k(e) { if (!document.body.contains(O)) return document.removeEventListener('keydown', k); if (phase === 0 || phase === -1) toCard() })
  C.querySelector('.onbSk').onclick = finish
  C.querySelector('.onbBk').onclick = () => i > 0 && show(i - 1, -1)
  C.querySelector('.onbNx').onclick = () => (i < STEPS.length - 1 ? show(i + 1, 1) : finish())
}
