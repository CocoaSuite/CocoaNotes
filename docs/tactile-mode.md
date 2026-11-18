# Tactile mode

A second way to use CocoaNotes, made to feel like a real pencil case and real paper. It is a setting
(Settings, Interface, Style: Classic or Tactile) and can also be picked in the Hello.

## What ships in 1.0

The storyboard, built:

1. **Slide the case out.** A grey tab sits on the right edge. Pull it (the case follows your finger)
   or tap it. The case springs open with a slide sound and a haptic tick.
2. **Pick a pen.** Pens stand in the case at full height, each drawn as itself: ballpoint, fountain
   pen, pencil, calligraphy pen, marker, highlighter. The pen in your hand leaves an empty slot.
   The text stamp (T), eraser block and lasso sit in the corner.
3. **Drag it onto the page.** The pen follows your finger and tips to writing angle as it leaves the
   case; the case slides shut behind it. A tap lifts the pen out to the middle instead.
4. **Pop the cap off.** Flick or tap the cap: it pops off with a hollow "pop" and a stronger haptic.
   The pencil has no cap and goes straight to the next step.
5. **Grab.** The pen lifts, shrinks toward its tip and fades: it is in your hand, ready to write.

While writing, each pen has its own sound, made live from its speed and pressure: pencil scratch,
ballpoint glide, fountain-nib hush, felt-tip marker, highlighter squeak. Adding a page rustles.

All of it lives in two files, so classic mode is untouched:

- `js/fx.js`: every sound is made in code with Web Audio (no audio files, works offline), plus
  haptics (`navigator.vibrate` on Android, the hidden `<input switch>` tick on iPhone and iPad).
- `js/tactile.js`: the case, the held pen, the cap and the grab.

The editor only exposes four hooks for it: `choosePen`, `chooseTool`, `currentPen` and `penInk`, and calls
`fx.writeStart / writeMove / writeEnd` around each stroke.

## Next steps

Ideas are in rough order of feel per effort.

- **Put the pen back.** Drag the pen in hand (a small pen "shadow" by the tray) back to the case, cap
  clicks on, case closes. Today a new pick simply swaps pens.
- **Page turns.** In tactile journals, swipe at the page corner to curl and turn the page (CSS 3D
  transform over a snapshot of the page), with the page sound. Scrolling stays available.
- **Tearing a page out.** Drag a page's corner off the edge to delete it, with the tear sound
  (already in `fx.js`) and Undo.
- **Paper grain.** Optional subtle paper texture and slightly softer ink edges in tactile journals,
  drawn by the renderer, so exports stay clean vectors.
- **Recorded sounds.** If the synthesised sounds are not warm enough, swap in short recorded samples
  per pen (`sounds/pen-*.mp3`), still shaped live by speed and pressure. Keep the code path so the
  app still works offline and fast.
- **Ink colours as bottles.** Colours as little ink bottles or a colour wheel lid in the case; dipping
  the fountain pen refills the colour.
- **Haptic texture.** A faint repeating tick while writing on grid or dotted paper, on devices that
  support it.
- **Desk.** Optional desk surface around journal pages (wood or felt) instead of the dark grey.

## Rules to keep

- Never slower than classic. The case and animations run on transforms only, and sounds are created
  lazily after the first tap.
- Everything is optional: sounds have their own setting (Auto, On, Off), haptics too, and reduced
  motion skips the animations.
- Writing itself is identical in both modes; only how you pick tools changes.
