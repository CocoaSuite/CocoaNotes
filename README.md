# CocoaNotes

Handwritten notes for college, part of CocoaSuite. Made for iPad and other tablets first; runs in any
modern browser and installs to the Home Screen. Works offline.

**Open it:** https://cocoasuite.github.io/CocoaNotes/

## What it does

- **Journals.** A4 pages, vertical or horizontal, with blank, ruled, college, grid, dotted or Cornell
  lining, on white, cream, gray or dark paper. Collapsible page list with thumbnails; add, duplicate,
  move and delete pages.
- **Infinite canvases.** No edges; zoom from 5% to 3000%. Blank, grid, dotted or ruled.
- **Pens.** Ballpoint, fountain pen, pencil (tilt to shade), calligraphy (broad nib at an adjustable
  angle), marker and highlighter (goes behind ink, snaps straight). Eraser, lasso (move, resize,
  recolour, copy, duplicate, delete), shapes (line, arrow, rectangle, ellipse) and text.
- **Vector ink.** Every stroke is stored as its points and drawn as a vector outline, so it stays sharp
  at any zoom, prints as vectors and exports to SVG and PDF.
- **Pictures.** Paste (keyboard or the Paste picture button), drag and drop, or pick from Photos or
  Files. Move and resize them with the lasso.
- **Text.** Tap the page with the text tool and type. Sans, serif, hand or mono; size, bold and colour;
  drag the side handle to change the wrap width.
- **Tablet first.** Apple Pencil and other styluses write while fingers scroll and pinch (automatic as
  soon as a pen touches), palm rejection, pressure, tilt, hover preview, stylus eraser buttons,
  two-finger tap to undo and three-finger tap to redo, momentum scrolling, and a pen tray you can put
  at the bottom, left or right.
- **Tactile mode.** Pens live in a case you slide out: pick a pen, drag it onto the page, pop the cap,
  and it is in your hand, with pen-on-paper sounds and haptics. See [docs/tactile-mode.md](docs/tactile-mode.md).
- **Hello.** First launch writes "hello" (or «привет» on a Russian system) in one stroke with the
  CocoaSuite hello sound, then sets the app up for how you write.

## Nothing gets lost

1. Every change is written to this device's storage (IndexedDB) within a moment, in one
   transaction per save. If a write fails it stays queued in memory and is retried; leaving the app
   flushes it immediately.
2. The app asks the browser to protect its storage so it is not cleared to free space (granted for
   Home Screen apps).
3. Cloud uploads wait in an outbox that is itself stored on the device. Offline, a service down, an
   expired sign-in: the upload just waits and is retried automatically (5 s, 15 s, 30 s, 1 min, 2 min,
   5 min, then every 10 min), and straight away when the connection comes back.
4. Pictures always upload before the notebook that uses them.
5. If the same notebook changed on two devices, both versions are kept.
6. Settings, Storage and backup makes a single backup file of everything and restores it (restoring
   only adds, it never replaces newer notes).

The status chip in the top bar always says whether your notes are saved on the device, and
separately how the cloud copy is doing; tap it for details and Retry now.

## Cloud sync setup (once, by whoever hosts the app)

Add the IDs to `js/config.js` (or paste them in Settings, Cloud sync, Sign-in keys on one device).

**Google Drive**
1. Google Cloud console: create a project and enable the **Google Drive API**.
2. OAuth consent screen: add the scope `https://www.googleapis.com/auth/drive.file` (the app can only
   see files it creates).
3. Credentials: OAuth client ID, type **Web application**, authorised JavaScript origin
   `https://cocoasuite.github.io`.
4. Put the client ID in `googleClientId`.

Google sign-ins last an hour in the browser. When one runs out, changes wait on the device and the
status chip offers "Sign in to Google Drive"; nothing is lost.

**Yandex Disk**
1. https://oauth.yandex.ru: create an app for web services with the permission
   "Access to app folder in Yandex Disk".
2. Redirect URI: `https://cocoasuite.github.io/CocoaNotes/`
3. Put the app ID in `yandexClientId`.

Yandex tokens last about a year. Note: Yandex serves its download links from a separate host; if a
browser blocks reading them (CORS), uploads still work and the pull from other devices needs a small
proxy. This has not been tested with real keys yet.

## Hosting

Plain files, no build step. GitHub Pages: Settings, Pages, deploy from branch `main`, folder `/`.
`sw.js` caches the app for offline use; bump its cache name (`cocoanotes-v1`) when releasing.

## Code

| File | What it is |
| --- | --- |
| `js/ink.js` | Pens, pressure and tilt, vector outlines, hit testing, shapes |
| `js/render.js` | Paper, lining, drawing items, SVG export |
| `js/editor.js` | Writing surface: input, gestures, tools, selection, text, pictures, pages |
| `js/store.js` | Notebooks in memory, saving to the device, thumbnails, backups |
| `js/db.js` | IndexedDB |
| `js/sync.js` | Google Drive and Yandex Disk, outbox and retries, pulling changes |
| `js/status.js` | Save and sync indicator |
| `js/library.js` | Library, subjects, new-notebook sheet |
| `js/settings.js` | Settings |
| `js/onboard.js` | The Hello |
| `js/fx.js`, `js/tactile.js` | Tactile mode: sounds, haptics, the pen case |

Keys: 1 to 6 pens, E eraser, L lasso, T text, S shapes, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo,
Ctrl/Cmd+D duplicate, Delete removes a selection, Space and drag to pan, Ctrl/Cmd and scroll to zoom.
