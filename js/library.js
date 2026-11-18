// The library: subjects, notebooks and the new-notebook sheet.
import { h, $, icon, iconBtn, sheet, menu, confirmSheet, promptSheet, toast, ago, popover, closePop } from './ui.js'
import { state, settings, saveSettings, createNotebook, updateNotebook, deleteForever, duplicateNotebook, saveSubjects, SUBJECT_COLORS, on as onStore, thumbURL } from './store.js'
import { PAPERS, LININGS_J, LININGS_C, drawLining } from './render.js'
import { enqueueDelete } from './sync.js'
import { syncChip } from './status.js'

let view = { filter: 'all', place: 'all', q: '', sort: 'updated' }
let openNb = () => { }
let openSettings = () => { }

export function initLibrary(opts) {
  openNb = opts.open
  openSettings = opts.settings
  $('#newBtn').onclick = () => newSheet()
  $('#openSettings').onclick = () => openSettings()
  $('#q').addEventListener('input', (e) => { view.q = e.target.value.trim().toLowerCase(); renderGrid() })
  $('#libMenu').onclick = () => $('#lib').classList.toggle('sideOpen')
  $('#sideScrim').onclick = () => $('#lib').classList.remove('sideOpen')
  syncChip($('#syncChipL'))
  onStore((ev, id) => {
    if (ev === 'thumb') { refreshThumb(id); return }
    if (ev === 'notebooks' || ev === 'subjects') renderAll()
  })
  renderAll()
}

export function renderAll() { renderSide(); renderGrid() }

function count(fn) { let n = 0; for (const nb of state.notebooks.values()) if (fn(nb)) n++; return n }

function renderSide() {
  const side = $('#side')
  const item = (place, ic, label, n) => h('button', { class: 'sr' + (view.place === place ? ' on' : ''), onclick: () => { view.place = place; $('#lib').classList.remove('sideOpen'); renderAll() } }, icon(ic), h('span', { class: 'sp' }, label), n != null ? h('span', { class: 'n' }, String(n)) : null)
  side.replaceChildren(
    h('div', { class: 'ph' }, 'Library'),
    item('all', 'book', 'All notes', count(nb => !nb.trashed)),
    item('recent', 'clock', 'Recent'),
    item('fav', 'star', 'Favorites', count(nb => nb.fav && !nb.trashed)),
    item('trash', 'trash', 'Trash', count(nb => nb.trashed)),
    h('div', { class: 'ph' }, 'Subjects', iconBtn('plus', 'Add subject', () => editSubject(), 'ic sm')),
    ...state.subjects.map(s => {
      const b = h('button', { class: 'sr subj' + (view.place === 's:' + s.id ? ' on' : ''), onclick: () => { view.place = 's:' + s.id; $('#lib').classList.remove('sideOpen'); renderAll() } },
        h('i', { class: 'sdot', style: { background: s.color } }), h('span', { class: 'sp' }, s.name), h('span', { class: 'n' }, String(count(nb => nb.subject === s.id && !nb.trashed))))
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); subjMenu(b, s) })
      let lp = 0
      b.addEventListener('pointerdown', () => { lp = setTimeout(() => subjMenu(b, s), 550) })
      b.addEventListener('pointerup', () => clearTimeout(lp)); b.addEventListener('pointerleave', () => clearTimeout(lp))
      return b
    }),
    h('span', { class: 'grow' })
  )
}

function subjMenu(anchor, s) {
  menu(anchor, [
    { label: 'Rename or recolor', icon: 'pen', run: () => editSubject(s) },
    { label: 'Delete subject', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmSheet('Delete “' + s.name + '”?', 'Its notebooks stay in your library, just without a subject.', 'Delete', { danger: true }))) return
      state.subjects = state.subjects.filter(x => x.id !== s.id)
      for (const nb of state.notebooks.values()) if (nb.subject === s.id) updateNotebook(nb.id, { subject: null })
      if (view.place === 's:' + s.id) view.place = 'all'
      saveSubjects()
    } }
  ])
}

function editSubject(s) {
  const isNew = !s
  s = s || { id: 's' + Date.now().toString(36), name: '', color: SUBJECT_COLORS[state.subjects.length % SUBJECT_COLORS.length] }
  let color = s.color
  const inp = h('input', { type: 'text', value: s.name, placeholder: 'Calculus II', 'aria-label': 'Subject name' })
  const sw = h('div', { class: 'row wrap' }, SUBJECT_COLORS.map(c => h('button', { type: 'button', class: 'sw lg' + (c === color ? ' on' : ''), 'aria-label': 'Color ' + c, onclick: (e) => { color = c; sw.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)) } }, h('span', { style: { background: c } }))))
  const form = h('form', { class: 'sb', onsubmit: (e) => {
    e.preventDefault()
    const name = inp.value.trim()
    if (!name) { inp.focus(); return }
    s.name = name; s.color = color
    if (isNew) state.subjects.push(s)
    saveSubjects()
    m.close()
  } }, h('label', { class: 'fl' }, h('span', { class: 'slT' }, 'Name'), inp), h('div', { class: 'slT' }, 'Color'), sw,
    h('div', { class: 'row end' }, h('button', { type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'pri', type: 'submit' }, isNew ? 'Add subject' : 'Save')))
  const m = sheet(isNew ? 'New subject' : 'Edit subject', form)
  setTimeout(() => inp.focus(), 80)
}

function visible() {
  let list = [...state.notebooks.values()]
  if (view.place === 'trash') list = list.filter(nb => nb.trashed)
  else {
    list = list.filter(nb => !nb.trashed)
    if (view.place === 'fav') list = list.filter(nb => nb.fav)
    if (view.place.startsWith('s:')) list = list.filter(nb => nb.subject === view.place.slice(2))
    if (view.place === 'recent') list = list.filter(nb => Date.now() - nb.updated < 7 * 86400000)
  }
  if (view.filter !== 'all') list = list.filter(nb => (view.filter === 'canvas') === (nb.type === 'canvas'))
  if (view.q) list = list.filter(nb => nb.title.toLowerCase().includes(view.q) || (state.subjects.find(s => s.id === nb.subject)?.name || '').toLowerCase().includes(view.q))
  const by = { updated: (a, b) => b.updated - a.updated, created: (a, b) => b.created - a.created, name: (a, b) => a.title.localeCompare(b.title) }[view.sort]
  return list.sort(by)
}

function placeTitle() {
  if (view.place === 'all') return 'All notes'
  if (view.place === 'recent') return 'Recent'
  if (view.place === 'fav') return 'Favorites'
  if (view.place === 'trash') return 'Trash'
  return state.subjects.find(s => 's:' + s.id === view.place)?.name || 'Notes'
}

function renderGrid() {
  const main = $('#grid')
  const list = visible()
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [['all', 'All'], ['journal', 'Journals'], ['canvas', 'Canvases']].map(([id, label]) => h('button', { class: view.filter === id ? 'on' : '', onclick: () => { view.filter = id; renderGrid() } }, label)))
  const sortB = h('button', { class: 'sortB', onclick: (e) => menu(e.currentTarget, [['updated', 'Last edited'], ['created', 'Date created'], ['name', 'Name']].map(([id, label]) => ({ label: (view.sort === id ? '✓ ' : '') + label, run: () => { view.sort = id; renderGrid() } }))) }, { updated: 'Last edited', created: 'Date created', name: 'Name' }[view.sort], icon('down'))
  const head = h('div', { class: 'gh' }, h('h1', {}, placeTitle()), h('span', { class: 'sp' }), seg, sortB)
  const cards = h('div', { class: 'cards' })
  for (const nb of list) cards.append(cardFor(nb))
  main.replaceChildren(head)
  if (view.place === 'trash' && list.length) main.append(h('p', { class: 'mute' }, 'Notebooks in the trash stay on this device until you delete them forever.'))
  if (!list.length) main.append(empty())
  else main.append(cards)
}

function empty() {
  if (view.place === 'trash') return h('div', { class: 'empty' }, icon('trash'), h('p', {}, 'Trash is empty'))
  if (view.q) return h('div', { class: 'empty' }, icon('search'), h('p', {}, 'No notes match “' + view.q + '”'))
  return h('div', { class: 'empty' },
    h('div', { class: 'emptyArt', html: '<svg viewBox="0 0 120 90" aria-hidden="true"><rect x="18" y="8" width="56" height="74" rx="4" fill="#2a2a2a" stroke="#444"/><rect x="18" y="8" width="7" height="74" fill="#F5913E"/><path d="M34 30h30M34 40h30M34 50h22" stroke="#555" stroke-width="2" stroke-linecap="round"/><path d="M78 70l26-26 6 6-26 26-8 2z" fill="none" stroke="#F5913E" stroke-width="2.4" stroke-linejoin="round"/></svg>' }),
    h('p', {}, 'Your first notebook is one tap away.'),
    h('button', { class: 'pri', onclick: () => newSheet(view.place.startsWith('s:') ? view.place.slice(2) : null) }, icon('plus'), 'New notebook'))
}

// Cards are kept and reused while nothing on them changed, so the library never rebuilds
// pictures it already shows (no flashing when menus act or notes save).
const cardCache = new Map()
function cardFor(nb) {
  const subj = state.subjects.find(s => s.id === nb.subject)
  const key = [nb.title, nb.type, nb.orient, nb.paper, nb.cover, nb.pages, nb.fav, nb.trashed, subj?.name, subj?.color, Math.floor((Date.now() - nb.updated) / 60000)].join('|')
  const c = cardCache.get(nb.id)
  if (c && c.key === key) return c.el
  const el = card(nb)
  cardCache.set(nb.id, { key, el })
  return el
}
async function refreshThumb(id) {
  const c = cardCache.get(id)
  if (!c) return
  const u = await thumbURL(id)
  const img = c.el.querySelector('.thumb img')
  if (u && img && img.src !== u) {
    // Swap without a blank frame: load the new picture first.
    const pre = new Image(); pre.onload = () => { img.src = u }; pre.src = u
  }
}

function card(nb) {
  const subj = state.subjects.find(s => s.id === nb.subject)
  const thumb = h('div', { class: 'thumb ' + (nb.type === 'canvas' ? 'cv' : nb.orient === 'h' ? 'jh' : 'jv') })
  // Paper colour shows at once; the preview image fades in over it when ready, no flash.
  const P = PAPERS[nb.paper] || PAPERS.white
  const img = h('img', { alt: '', decoding: 'async' })
  img.onload = () => img.classList.add('in')
  thumb.append(nb.type === 'canvas' ? h('div', { class: 'pgc', style: { background: P.bg } }, img) : h('div', { class: 'pgm', style: { background: P.bg } }, h('i', { class: 'spine', style: { background: nb.cover } }), img))
  thumbURL(nb.id).then(u => { if (u) img.src = u })
  thumb.append(h('span', { class: 'kind' }, nb.type === 'canvas' ? 'Canvas' : 'Journal'))
  if (nb.fav) thumb.append(h('span', { class: 'fav' }, icon('star')))
  const meta = [subj ? subj.name : null, nb.type === 'canvas' ? null : `${nb.pages || 1} page${(nb.pages || 1) > 1 ? 's' : ''}`, ago(nb.updated)].filter(Boolean).join(', ')
  const el = h('div', { class: 'card' },
    h('button', { class: 'open', 'aria-label': 'Open ' + nb.title, onclick: () => nb.trashed ? trashMenu(el, nb) : openNb(nb.id) }, thumb),
    h('div', { class: 'cm' },
      h('div', { class: 'ct2' }, h('div', { class: 'tt' }, nb.title), h('div', { class: 'mm' }, subj ? h('i', { class: 'sdot', style: { background: subj.color } }) : null, h('span', {}, meta))),
      iconBtn('more', 'Options for ' + nb.title, (e) => nb.trashed ? trashMenu(e.currentTarget, nb) : cardMenu(e.currentTarget, nb), 'ic sm')))
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); nb.trashed ? trashMenu(el, nb) : cardMenu(el.querySelector('.cm .ic'), nb) })
  return el
}

function cardMenu(anchor, nb) {
  menu(anchor, [
    { label: 'Open', icon: 'book', run: () => openNb(nb.id) },
    { label: 'Rename', icon: 'pen', run: async () => { const t = await promptSheet('Rename', nb.title); if (t) updateNotebook(nb.id, { title: t }) } },
    { label: 'Subject', icon: 'list', run: () => pickSubject(anchor, nb) },
    { label: nb.fav ? 'Remove from favorites' : 'Add to favorites', icon: 'star', run: () => updateNotebook(nb.id, { fav: !nb.fav }) },
    { label: 'Duplicate', icon: 'dup', run: () => duplicateNotebook(nb.id) },
    '-',
    { label: 'Move to trash', icon: 'trash', danger: true, run: () => { updateNotebook(nb.id, { trashed: true, trashedAt: Date.now() }); toast('Moved to trash', { label: 'Undo', run: () => updateNotebook(nb.id, { trashed: false }) }) } }
  ])
}

function pickSubject(anchor, nb) {
  menu(anchor, [{ label: 'Subject', header: true }, { label: (nb.subject ? '' : '✓ ') + 'No subject', run: () => updateNotebook(nb.id, { subject: null }) }, ...state.subjects.map(s => ({ label: (nb.subject === s.id ? '✓ ' : '') + s.name, run: () => updateNotebook(nb.id, { subject: s.id }) }))])
}

function trashMenu(anchor, nb) {
  menu(anchor, [
    { label: 'Restore', icon: 'restore', run: () => updateNotebook(nb.id, { trashed: false }) },
    { label: 'Delete forever', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmSheet('Delete “' + nb.title + '” forever?', 'It is removed from this device and from your connected cloud. This cannot be undone.', 'Delete forever', { danger: true }))) return
      await deleteForever(nb.id)
      enqueueDelete(nb.id)
    } }
  ])
}

// ------------------------------------------------------------- new notebook

export function newSheet(subject = null) {
  const o = { type: 'journal', orient: 'v', lining: settings.defLining || 'college', paper: settings.defPaper || 'white', cover: '#F5913E', subject: subject || (view.place.startsWith('s:') ? view.place.slice(2) : null), title: '' }
  const body = h('div', { class: 'nn' })
  const s = sheet('New notebook', body, { wide: true })
  const draw = () => {
    const isJ = o.type === 'journal'
    const L = isJ ? LININGS_J : LININGS_C
    if (!L.some(l => l[0] === o.lining)) o.lining = isJ ? (settings.defLining || 'college') : (settings.defCanvasLining || 'dotted')
    const prev = h('canvas', { class: 'nnPrev' })
    const typeCard = (id, ic, title, text) => h('button', { class: 'tc' + (o.type === id ? ' on' : ''), onclick: () => { o.type = id; draw() } }, icon(ic), h('span', {}, h('b', {}, title), h('span', { class: 'mute' }, text)))
    const seg = (items, key) => h('div', { class: 'seg' }, items.map(([id, label]) => h('button', { class: o[key] === id ? 'on' : '', onclick: () => { o[key] = id; draw() } }, label)))
    const lin = h('div', { class: 'lgrid six' }, L.map(([id, name]) => {
      const c = h('canvas', { width: 120, height: 84 })
      const g = c.getContext('2d'); g.setTransform(0.6, 0, 0, 0.6, 0, 0)
      g.fillStyle = PAPERS[o.paper].bg; g.fillRect(0, 0, 200, 140)
      drawLining(g, id, o.paper, [0, 0, 200, 140], 0.6, isJ ? [200, 1000] : null)
      return h('button', { class: 'lt' + (o.lining === id ? ' on' : ''), onclick: () => { o.lining = id; draw() } }, c, h('span', {}, name))
    }))
    const papers = h('div', { class: 'row' }, Object.entries(PAPERS).map(([id, P]) => h('button', { class: 'sw lg' + (o.paper === id ? ' on' : ''), 'aria-label': P.name + ' paper', title: P.name, onclick: () => { o.paper = id; draw() } }, h('span', { style: { background: P.bg } }))))
    const covers = h('div', { class: 'row' }, ['#F5913E', '#6fbf8a', '#d98bb0', '#8AA7D9', '#d9c36a', '#3b3b3b'].map(c => h('button', { class: 'sw lg' + (o.cover === c ? ' on' : ''), 'aria-label': 'Cover ' + c, onclick: () => { o.cover = c; draw() } }, h('span', { style: { background: c } }))))
    const name = h('input', { type: 'text', value: o.title, placeholder: isJ ? 'Lecture notes' : 'Mind map', 'aria-label': 'Name', oninput: (e) => { o.title = e.target.value } })
    const subj = h('select', { 'aria-label': 'Subject', onchange: (e) => { o.subject = e.target.value || null } }, h('option', { value: '' }, 'No subject'), state.subjects.map(su => h('option', { value: su.id, selected: o.subject === su.id }, su.name)))
    body.replaceChildren(
      h('div', { class: 'nnL' }, h('div', { class: 'slT' }, 'Preview'), h('div', { class: 'nnPB' }, prev), h('b', {}, isJ ? `Journal, A4 ${o.orient === 'v' ? 'vertical' : 'horizontal'}` : 'Infinite canvas'), h('span', { class: 'mute small' }, `${L.find(l => l[0] === o.lining)[1]} lining on ${PAPERS[o.paper].name.toLowerCase()} paper`)),
      h('div', { class: 'nnR' },
        h('div', { class: 'two' }, typeCard('journal', 'book', 'Journal', 'A4 pages you flip through. Prints cleanly.'), typeCard('canvas', 'inf', 'Infinite canvas', 'Endless space for maps and diagrams.')),
        h('div', { class: 'row wrap gapL' },
          isJ ? h('div', { class: 'fg' }, h('div', { class: 'slT' }, 'Orientation'), seg([['v', 'Vertical'], ['h', 'Horizontal']], 'orient')) : null,
          h('div', { class: 'fg' }, h('div', { class: 'slT' }, 'Paper'), papers),
          isJ ? h('div', { class: 'fg' }, h('div', { class: 'slT' }, 'Cover'), covers) : null),
        h('div', { class: 'fg' }, h('div', { class: 'slT' }, 'Lining'), lin),
        h('div', { class: 'two' }, h('label', { class: 'fl' }, h('span', { class: 'slT' }, 'Name'), name), h('label', { class: 'fl' }, h('span', { class: 'slT' }, 'Subject'), subj)),
        h('div', { class: 'row end' }, h('button', { onclick: () => s.close() }, 'Cancel'), h('button', { class: 'pri', onclick: create }, 'Create'))))
    // Preview of the chosen paper.
    const isH = isJ && o.orient === 'h'
    const pw = isJ ? (isH ? 230 : 170) : 240, ph = isJ ? (isH ? 163 : 240) : 200
    prev.width = pw * 2; prev.height = ph * 2
    prev.style.width = pw + 'px'; prev.style.height = ph + 'px'
    const g = prev.getContext('2d')
    const sc = isJ ? pw / (isH ? 1123 : 794) : 0.8
    g.setTransform(2 * sc, 0, 0, 2 * sc, 0, 0)
    g.fillStyle = PAPERS[o.paper].bg; g.fillRect(0, 0, pw / sc, ph / sc)
    drawLining(g, o.lining, o.paper, [0, 0, pw / sc, ph / sc], sc, isJ ? [pw / sc, ph / sc] : null)
    if (isJ) { g.setTransform(2, 0, 0, 2, 0, 0); g.fillStyle = o.cover; g.fillRect(0, 0, 8, ph) }
    prev.classList.toggle('cv', !isJ)
  }
  const create = async () => {
    s.close()
    const nb = await createNotebook({ ...o, title: o.title.trim() })
    openNb(nb.id)
  }
  draw()
}
