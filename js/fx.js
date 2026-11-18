// Sound and touch feedback. Every sound is made in code with Web Audio (no files to load), so the
// tactile mode works offline and each pen can sound like itself: pencil scratch, felt marker hush,
// fountain nib glide. Haptics use vibration where the browser has it, and the iOS switch tick.
import { settings } from './store.js'

let ac = null, noise = null, master = null
const on = () => settings.sounds === true || (settings.sounds !== false && settings.ux === 'tactile')

/** Must first run inside a tap: browsers only allow audio after a gesture. */
export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return }
  const C = window.AudioContext || window.webkitAudioContext
  if (!C) return
  ac = new C()
  master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination)
  const len = ac.sampleRate * 2
  noise = ac.createBuffer(1, len, ac.sampleRate)
  const d = noise.getChannelData(0)
  // Pinkish noise sounds like paper rather than hiss.
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2 }
}
addEventListener('pointerdown', unlock, { capture: true, passive: true })

function src() { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); return s }

// Per pen: band centre, width, loudness and grain (fast tremble that gives a scratchy texture).
const VOICE = {
  ball: { f: 2600, q: 1.1, g: 0.22, grain: 0.25 },
  fountain: { f: 1900, q: 1.4, g: 0.16, grain: 0.1 },
  pencil: { f: 3600, q: 0.7, g: 0.42, grain: 0.6 },
  calli: { f: 1500, q: 1.2, g: 0.2, grain: 0.15 },
  marker: { f: 900, q: 0.8, g: 0.28, grain: 0.05 },
  high: { f: 750, q: 1.5, g: 0.22, grain: 0.05 }
}

let w = null
export function writeStart(pen) {
  if (!on() || !ac) return
  writeEnd()
  const v = VOICE[pen] || VOICE.ball
  const s = src(), bp = ac.createBiquadFilter(), hp = ac.createBiquadFilter(), g = ac.createGain(), trem = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain()
  bp.type = 'bandpass'; bp.frequency.value = v.f; bp.Q.value = v.q
  hp.type = 'highpass'; hp.frequency.value = 280
  g.gain.value = 0
  lfo.frequency.value = 38 + Math.random() * 20; lg.gain.value = v.grain * 0.5; trem.gain.value = 1 - v.grain * 0.5
  lfo.connect(lg); lg.connect(trem.gain)
  s.connect(bp); bp.connect(hp); hp.connect(trem); trem.connect(g); g.connect(master)
  s.start(); lfo.start()
  w = { s, g, bp, lfo, v, last: performance.now() }
}
/** speed in screen px per ms, pressure 0..1 */
export function writeMove(speed, pressure = 0.5) {
  if (!w) return
  const t = ac.currentTime
  const level = Math.min(1, speed / 1.6) * (0.55 + 0.6 * pressure) * w.v.g
  w.g.gain.setTargetAtTime(level, t, 0.02)
  w.bp.frequency.setTargetAtTime(w.v.f * (0.85 + Math.min(0.5, speed * 0.25)), t, 0.04)
  clearTimeout(w.idle)
  // Holding still goes quiet.
  w.idle = setTimeout(() => w && w.g.gain.setTargetAtTime(0, ac.currentTime, 0.04), 60)
}
export function writeEnd() {
  if (!w) return
  const { s, g, lfo } = w
  w = null
  g.gain.setTargetAtTime(0, ac.currentTime, 0.03)
  setTimeout(() => { try { s.stop(); lfo.stop() } catch { } }, 200)
}

function burst({ f = 1200, q = 1, dur = 0.12, gain = 0.3, sweep = 0, type = 'bandpass' }) {
  const t = ac.currentTime, s = src(), b = ac.createBiquadFilter(), g = ac.createGain()
  b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q
  if (sweep) b.frequency.exponentialRampToValueAtTime(Math.max(60, f * sweep), t + dur)
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  s.connect(b); b.connect(g); g.connect(master)
  s.start(t); s.stop(t + dur + 0.05)
}
function tone({ f = 600, to = 300, dur = 0.08, gain = 0.2, type = 'sine' }) {
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02)
}

const SOUNDS = {
  slide: () => burst({ f: 500, q: 0.6, dur: 0.32, gain: 0.25, sweep: 2.2 }),          // case sliding on the desk
  slideBack: () => burst({ f: 1100, q: 0.6, dur: 0.26, gain: 0.2, sweep: 0.45 }),
  pick: () => { tone({ f: 1800, to: 900, dur: 0.035, gain: 0.12, type: 'triangle' }); burst({ f: 2400, q: 2, dur: 0.05, gain: 0.12 }) },
  cap: () => { tone({ f: 420, to: 160, dur: 0.09, gain: 0.35 }); burst({ f: 3200, q: 3, dur: 0.035, gain: 0.25 }) }, // the hollow "pop"
  grab: () => { tone({ f: 900, to: 700, dur: 0.05, gain: 0.08, type: 'triangle' }); burst({ f: 1500, q: 1, dur: 0.08, gain: 0.08 }) },
  page: () => burst({ f: 2400, q: 0.5, dur: 0.38, gain: 0.22, sweep: 0.3, type: 'bandpass' }),
  tick: () => tone({ f: 2200, to: 1800, dur: 0.02, gain: 0.07, type: 'square' }),
  tear: () => burst({ f: 3000, q: 0.4, dur: 0.25, gain: 0.25, sweep: 0.5 })
}

export function play(name) { if (on() && ac && SOUNDS[name]) SOUNDS[name]() }

let sw = null
/** A short tap of haptic feedback. Android vibrates; on iPhone and iPad a hidden switch gives the system tick. */
export function haptic(kind = 'light') {
  if (settings.haptics === false) return
  if (navigator.vibrate) { navigator.vibrate(kind === 'heavy' ? 18 : kind === 'medium' ? 12 : 7); return }
  try {
    if (!sw) {
      const lab = document.createElement('label'), inp = document.createElement('input')
      inp.type = 'checkbox'; inp.setAttribute('switch', '')
      lab.append(inp); lab.setAttribute('aria-hidden', 'true')
      lab.style.cssText = 'position:fixed;left:-99px;top:-99px;opacity:0;pointer-events:none'
      document.body.append(lab); sw = lab
    }
    sw.click()
  } catch { }
}

export const feedback = (sound, h = 'light') => { play(sound); haptic(h) }
export const soundsOn = on
