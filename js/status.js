// The save and sync indicator. It always says whether your notes are safe on this device,
// and separately whether the cloud copy has caught up.
import { h, icon, popover, closePop, toast } from './ui.js'
import { state, isDirty, on as onStore } from './store.js'
import { syncInfo, onSync, PROVIDERS, retryNow, online } from './sync.js'
import { db } from './db.js'

const chips = new Set()
let openSettings = () => { }
export function setOpenSettings(fn) { openSettings = fn }

function summary() {
  if (state.saveError) return { tone: 'bad', text: 'Saving on this device, retrying', long: 'Your latest changes are kept in memory and are being written to this device again. Keep the app open for a moment.' }
  if (isDirty() || state.saving) return { tone: 'busy', text: 'Saving', long: '' }
  const provs = Object.values(PROVIDERS).filter(p => p.connected())
  if (!provs.length) return { tone: 'ok', text: 'Saved on device', long: 'No cloud connected. Connect Google Drive or Yandex Disk to keep a copy and use your notes on other devices.' }
  const auth = provs.find(p => syncInfo[p.id].needsAuth || !p.ready())
  if (syncInfo.pending) {
    if (!online()) return { tone: 'warn', text: 'Saved on device, offline', long: 'Everything is saved here. Uploads start by themselves when you are back online.' }
    if (auth) return { tone: 'warn', text: 'Saved on device, sign in', long: `Everything is saved here. ${auth.name} needs you to sign in again before it can take the copy.` }
    if (syncInfo.busy) return { tone: 'busy', text: 'Uploading', long: '' }
    const s = Math.max(0, Math.round((syncInfo.nextAt - Date.now()) / 1000))
    return { tone: 'warn', text: s ? `Saved on device, retry in ${s}s` : 'Saved on device, uploading', long: 'Everything is saved here. The upload did not go through, so it is tried again automatically.' }
  }
  if (auth) return { tone: 'warn', text: 'Synced, sign in soon', long: `${auth.name} sign-in has expired. New changes will wait on this device until you sign in.` }
  return { tone: 'ok', text: 'Synced', long: '' }
}

function paint(chip) {
  const s = summary()
  chip.className = 'chip sync ' + s.tone
  chip.replaceChildren(h('i', { class: 'dot' }), h('span', { class: 'ct' }, s.text))
  chip.setAttribute('aria-label', 'Save status: ' + s.text)
}

export function syncChip(chip) {
  chips.add(chip)
  paint(chip)
  chip.onclick = () => detail(chip)
}

async function detail(anchor) {
  const s = summary()
  const out = await db.all('outbox').catch(() => [])
  const box = h('div', { class: 'penPop syncPop' },
    h('div', { class: 'srow' }, icon('device'), h('div', {}, h('b', {}, state.saveError ? 'Writing to this device' : 'Saved on this device'), h('div', { class: 'mute small' }, state.saveError ? 'Retrying now. Nothing is thrown away.' : 'Every stroke is stored here first, even offline.')), h('i', { class: 'dot ' + (state.saveError ? 'bad' : 'ok') })))
  for (const p of Object.values(PROVIDERS)) {
    if (!p.connected()) continue
    const mine = out.filter(e => e.pid === p.id)
    const needs = syncInfo[p.id].needsAuth || !p.ready()
    let line, tone
    if (needs) { line = `Sign in again to upload${mine.length ? ` ${mine.length} waiting change${mine.length > 1 ? 's' : ''}` : ''}`; tone = 'warn' }
    else if (mine.length) {
      const next = Math.min(...mine.map(e => e.next)), sec = Math.max(0, Math.round((next - Date.now()) / 1000))
      line = !online() ? `${mine.length} waiting until you are online` : sec ? `${mine.length} waiting, next try in ${sec}s` : `Uploading ${mine.length}`
      if (mine[0].err && sec) line += ` (${mine[0].err})`
      tone = 'warn'
    } else { line = syncInfo[p.id].lastOk ? 'Up to date' : 'Connected'; tone = 'ok' }
    const row = h('div', { class: 'srow' }, icon('cloud'), h('div', {}, h('b', {}, p.name), h('div', { class: 'mute small' }, line)), h('i', { class: 'dot ' + tone }))
    box.append(row)
    if (needs) box.append(h('button', { class: 'pri wide', onclick: async () => { closePop(); try { if (p.id === 'gdrive') await p.connect(true); else p.connect() } catch (e) { toast(e.message) } } }, 'Sign in to ' + p.name))
  }
  if (!Object.values(PROVIDERS).some(p => p.connected())) box.append(h('p', { class: 'mute small' }, s.long))
  box.append(h('div', { class: 'row' },
    out.length ? h('button', { onclick: () => { retryNow(); closePop(); toast('Trying again') } }, icon('sync'), 'Retry now') : null,
    h('span', { class: 'sp' }),
    h('button', { onclick: () => { closePop(); openSettings('cloud') } }, 'Cloud settings')))
  popover(anchor, box, { side: 'below' })
}

export function initStatus() {
  const all = () => chips.forEach(paint)
  onStore((ev) => { if (ev === 'dirty' || ev === 'saved' || ev === 'saveError' || ev === 'settings') all() })
  onSync(all)
  setInterval(() => { if (syncInfo.pending) all() }, 1000)
  addEventListener('online', all); addEventListener('offline', all)
}
