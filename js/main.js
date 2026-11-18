import { $ } from './ui.js'
import { load, state, settings, flush } from './store.js'
import { persist } from './db.js'
import { initLibrary, newSheet } from './library.js'
import { initEditor, openEditor, closeEditor, editorOpen } from './editor.js'
import { startSync } from './sync.js'
import { initStatus, setOpenSettings } from './status.js'
import { openSettings, setReplay } from './settings.js'
import { hello } from './onboard.js'

async function boot() {
  try { await load() } catch (err) {
    document.body.innerHTML = `<div class="fatal"><h1>CocoaNotes cannot open its storage</h1><p>${String(err.message || err)}</p><p>Private browsing can block it. Your notes are not deleted.</p></div>`
    return
  }
  initStatus()
  initEditor()
  setOpenSettings(openSettings)
  setReplay(() => { document.querySelector('#modal .mh .ic')?.click(); hello({ force: true }) })
  initLibrary({ open, settings: openSettings })
  startSync()

  // Ask once for storage the browser will not clear (granted for installed apps).
  addEventListener('pointerdown', () => persist(), { once: true })

  addEventListener('popstate', () => { if (editorOpen() && !location.hash.startsWith('#n/')) backToLibrary(false) })
  const m = location.hash.match(/^#n\/(\w+)/)
  if (m && state.notebooks.has(m[1]) && !state.notebooks.get(m[1]).trashed) open(m[1], false)

  if (!settings.onboarded) hello({ onDone: () => { if (!state.notebooks.size) newSheet() } })

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { })
  document.documentElement.classList.add('ready')
}

async function open(id, push = true) {
  $('#lib').hidden = true
  $('#ed').hidden = false
  if (push) history.pushState({ nb: id }, '', '#n/' + id)
  await openEditor(id, () => backToLibrary(true))
}

async function backToLibrary(pop) {
  if (editorOpen()) await closeEditor()
  $('#ed').hidden = true
  $('#lib').hidden = false
  if (pop && location.hash.startsWith('#n/')) history.replaceState(null, '', location.pathname + location.search)
  flush()
}

boot()
