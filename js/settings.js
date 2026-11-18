// Settings: interface, pen and touch, paper defaults, cloud sync, storage and backups.
import { h, icon, sheet, toast, download, confirmSheet } from './ui.js'
import { settings, saveSettings, exportBackup, importBackup, state } from './store.js'
import { PROVIDERS, syncInfo, onSync, retryNow, pull } from './sync.js'
import { persist } from './db.js'
import { LININGS_J, LININGS_C, PAPERS } from './render.js'
import { toggle } from './editor.js'
import { CONFIG } from './config.js'
import { feedback } from './fx.js'

const NAV = [['general', 'Interface', 'gear'], ['pencil', 'Pencil and touch', 'pen'], ['paper', 'Paper defaults', 'paper'], ['cloud', 'Cloud sync', 'cloud'], ['storage', 'Storage and backup', 'device'], ['about', 'About', 'info']]

let replayHello = () => { }
export function setReplay(fn) { replayHello = fn }

export function openSettings(section = 'general') {
  const nav = h('nav', { class: 'setNav' })
  const pane = h('div', { class: 'setPane' })
  const body = h('div', { class: 'settings' }, nav, pane)
  const s = sheet('Settings', body, { wide: true, onClose: () => off && off() })
  let off = null
  const show = (id) => {
    section = id
    nav.replaceChildren(...NAV.map(([k, label, ic]) => h('button', { class: 'sr' + (k === id ? ' on' : ''), onclick: () => show(k) }, icon(ic), h('span', {}, label))))
    off && off(); off = null
    pane.replaceChildren(...PANES[id]())
    if (id === 'cloud') off = onSync(() => { if (section === 'cloud') pane.replaceChildren(...PANES.cloud()) })
    pane.scrollTop = 0
  }
  show(section)
  return s
}

const row = (label, sub, control) => h('div', { class: 'srow2' }, h('div', { class: 'sp' }, h('div', { class: 'rl' }, label), sub ? h('div', { class: 'mute small' }, sub) : null), control)
const group = (...rows) => h('div', { class: 'sgroup' }, ...rows)
const seg = (opts, val, onPick) => {
  const b = h('div', { class: 'seg' })
  const draw = (v) => b.replaceChildren(...opts.map(([id, label]) => h('button', { class: v === id ? 'on' : '', onclick: () => { onPick(id); draw(id) } }, label)))
  draw(val)
  return b
}
const set = (k) => (v) => { settings[k] = v; saveSettings() }

const PANES = {
  general: () => [
    h('h3', {}, 'Interface'),
    group(
      row('Style', 'Tactile puts your pens in a case you slide out, with sounds and haptic ticks.', seg([['classic', 'Classic'], ['tactile', 'Tactile']], settings.ux, (v) => { settings.ux = v; saveSettings(); feedback(v === 'tactile' ? 'slide' : 'tick') })),
      row('Sounds', 'Pen on paper, cap pops, page turns. On by default in Tactile.', seg([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], settings.sounds === null ? 'auto' : settings.sounds ? 'on' : 'off', (v) => { settings.sounds = v === 'auto' ? null : v === 'on'; saveSettings() })),
      row('Haptics', 'Small taps of feedback when the device supports it', toggle(settings.haptics !== false, set('haptics'), 'Haptics')),
      row('Pen tray position', 'Move it away from your writing hand', seg([['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']], settings.tray, set('tray')))),
    h('div', { class: 'row' }, h('button', { onclick: () => replayHello() }, 'Show the Hello again'))
  ],
  pencil: () => [
    h('h3', {}, 'Pencil and touch'),
    h('p', { class: 'mute' }, 'Tuned for Apple Pencil, S Pen and other styluses. Fingers navigate, the pen writes.'),
    group(
      row('Fingers draw', 'Auto turns finger drawing off as soon as a pen touches the screen', seg([['auto', 'Auto'], ['yes', 'Yes'], ['no', 'No, pen only']], settings.penOnly === 'auto' ? 'auto' : settings.penOnly ? 'no' : 'yes', (v) => { settings.penOnly = v === 'auto' ? 'auto' : v === 'no'; saveSettings() })),
      row('Palm rejection', 'Ignore your hand resting on the screen while writing', toggle(settings.palm !== false, set('palm'), 'Palm rejection')),
      row('Hover preview', 'Show the nib before it touches, on pens that support hover', toggle(settings.hover !== false, set('hover'), 'Hover preview')),
      row('Pressure', 'Press harder for a wider line', toggle(settings.pressure !== false, set('pressure'), 'Pressure')),
      row('Two-finger tap to undo', 'Three-finger tap redoes', toggle(settings.twoFingerUndo !== false, set('twoFingerUndo'), 'Two-finger tap to undo'))),
    h('p', { class: 'mute small' }, 'Pinch to zoom, two fingers to scroll. A stylus eraser end or side button erases while held.')
  ],
  paper: () => [
    h('h3', {}, 'Paper defaults'),
    h('p', { class: 'mute' }, 'Used for new notebooks. You can change any notebook later from its lining button.'),
    group(
      row('Journal lining', null, seg(LININGS_J, settings.defLining, set('defLining'))),
      row('Canvas lining', null, seg(LININGS_C, settings.defCanvasLining, set('defCanvasLining'))),
      row('Paper', null, seg(Object.entries(PAPERS).map(([k, v]) => [k, v.name]), settings.defPaper, set('defPaper'))))
  ],
  cloud: () => {
    const card = (p) => {
      const c = p.connected()
      const ready = p.ready()
      const status = !c ? 'Not connected' : !ready || syncInfo[p.id].needsAuth ? 'Sign-in needed, your changes wait on this device' : syncInfo[p.id].lastErr ? 'Retrying: ' + syncInfo[p.id].lastErr : 'Connected'
      return h('div', { class: 'ccard' },
        h('div', { class: 'row' }, h('span', { class: 'cIc' }, icon('cloud')), h('div', { class: 'sp' }, h('b', {}, p.name), h('div', { class: 'mute small' }, status)), h('i', { class: 'dot ' + (!c ? '' : ready ? 'ok' : 'warn') })),
        h('div', { class: 'mute small' }, p.id === 'gdrive' ? 'Saved in a CocoaNotes folder in your Drive. The app can only see files it made.' : 'Saved in Apps / CocoaNotes on your Disk.'),
        h('div', { class: 'row' },
          !c || !ready ? h('button', { class: 'pri', onclick: async () => { try { await p.connect(false) } catch (e) { toast(e.message) } } }, c ? 'Sign in again' : 'Connect') : null,
          c ? h('button', { class: 'danger', onclick: async () => { if (await confirmSheet('Disconnect ' + p.name + '?', 'Notes stay on this device and in ' + p.name + '. New changes just stop being copied there.', 'Disconnect')) { p.disconnect(); toast('Disconnected') } } }, 'Disconnect') : null))
    }
    const keys = h('details', { class: 'keys' }, h('summary', {}, 'Sign-in keys (for whoever hosts the app)'),
      h('p', { class: 'mute small' }, 'If the hosted app has no keys yet, paste an OAuth client ID here. See the README.'),
      h('label', { class: 'fl' }, h('span', { class: 'slT' }, 'Google client ID'), h('input', { type: 'text', value: settings.googleClientId || '', placeholder: CONFIG.googleClientId || 'xxxx.apps.googleusercontent.com', onchange: (e) => set('googleClientId')(e.target.value.trim()) })),
      h('label', { class: 'fl' }, h('span', { class: 'slT' }, 'Yandex client ID'), h('input', { type: 'text', value: settings.yandexClientId || '', placeholder: CONFIG.yandexClientId || 'Yandex OAuth app ID', onchange: (e) => set('yandexClientId')(e.target.value.trim()) })))
    return [
      h('h3', {}, 'Cloud sync'),
      h('p', { class: 'mute' }, 'Notes are always saved on this device first. Uploads wait safely if you are offline or a service is down, and are tried again automatically until they go through.'),
      h('div', { class: 'two' }, card(PROVIDERS.gdrive), card(PROVIDERS.yandex)),
      group(
        row('Waiting uploads', syncInfo.pending ? `${syncInfo.pending} change${syncInfo.pending > 1 ? 's' : ''} saved here, waiting for the cloud` : 'Nothing waiting', h('button', { onclick: () => { retryNow(); pull(); toast('Syncing') } }, icon('sync'), 'Sync now'))),
      keys
    ]
  },
  storage: () => {
    const est = h('span', { class: 'mute small' }, 'Checking…')
    const pst = h('span', { class: 'mute small' }, '')
    navigator.storage?.estimate?.().then(e => { est.textContent = `${(e.usage / 1048576).toFixed(1)} MB used on this device` })
    navigator.storage?.persisted?.().then(p => { pst.textContent = p ? 'Protected: the browser will not clear your notes to free space.' : 'Not protected yet. Adding CocoaNotes to your Home Screen protects it.' })
    const pick = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return
      try { const n = await importBackup(f); toast(n ? `Restored ${n} notebook${n > 1 ? 's' : ''}` : 'Everything in the backup is already here') } catch (err) { toast(err.message) }
    } })
    return [
      h('h3', {}, 'Storage and backup'),
      group(
        row('On this device', est, h('span')),
        row('Storage protection', pst, h('button', { onclick: async () => { const ok = await persist(); toast(ok ? 'Storage is protected' : 'The browser did not allow it here') ; pst.textContent = ok ? 'Protected: the browser will not clear your notes to free space.' : pst.textContent } }, 'Protect'))),
      h('h3', {}, 'Backup'),
      h('p', { class: 'mute' }, 'One file with every notebook and picture. Restoring only adds notes; it never replaces newer ones.'),
      h('div', { class: 'row' }, h('button', { onclick: async () => { toast('Making backup…'); download(await exportBackup(), `CocoaNotes backup ${new Date().toISOString().slice(0, 10)}.json`) } }, icon('upload'), 'Download backup'), h('button', { onclick: () => pick.click() }, icon('restore'), 'Restore from backup'), pick)
    ]
  },
  about: () => [
    h('h3', {}, 'CocoaNotes'),
    h('p', { class: 'mute' }, `Version ${CONFIG.version}. Part of CocoaSuite. Make it yours.`),
    h('p', { class: 'mute' }, `${state.notebooks.size} notebook${state.notebooks.size === 1 ? '' : 's'} on this device.`),
    h('p', { class: 'mute small' }, 'Keys: 1 to 6 pens, E eraser, L lasso, T text, S shapes. Ctrl or Cmd with Z undo, plus Shift to redo. Space and drag to move around, Ctrl and scroll to zoom.')
  ]
}
