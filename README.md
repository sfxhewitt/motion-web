# KINETIC // motion

A mobile-first, browser-only motion-graphics editor — layers, keyframes, easing curves, WebGL effects, blend modes and video export.
Built as a personal tool for iPhone Safari (add it to your Home Screen) that works just as well on desktop.

The light home screen lists your projects (⋯ menu: rename / duplicate / delete); the mint **+** opens the Create sheet (name, ratio incl. custom, resolution, frame rate, background).

**Live:** https://sfxhewitt.github.io/motion-web/

> Personal, non-commercial project inspired by the *workflow* of mobile motion editors (such as Alight Motion).
> It has no affiliation with them, and it contains none of their code, assets, shaders, icons or fonts. Every visual and shader here is original.

## Features
- **Canvas presets:** 9:16, 16:9, 1:1, 4:5 and 4:3, plus FPS (24/25/30/60), duration and background colour.
- **Alight-style editor layout:** preview, transport row, a timeline with a fixed centre playhead and timecode pill, and a mint **+** that opens the add sheet (Shape / Media / Audio / Object / Template, plus Freehand Drawing, Vector Drawing and Text). Selecting a layer swaps the + for a tile grid (Color & Fill, Border & Shadow, Blending & Opacity, Move & Transform, Edit, Effects…). See `DESIGN-alight.md`.
- **Layers** (new ones go on top): 20 shapes (rect, ellipse, triangle, star, polygon, ring, line, heart, arrow, cross, pie…) with solid/gradient fill and stroke; vector paths drawn point by point (Edit Points); freehand drawings (pencil, brush, eraser, colour swatches); audio files; multi-line text with font, weight, tracking and stroke; solids with gradients; imported images and video; and adjustment layers that apply effects to everything below them.
- **Keyframes:** position X/Y, scale, rotation and opacity. Use ◆ per property, or KEY to keyframe them all at the playhead. Once a property is animated, any edit you make creates a keyframe. A motion path is drawn on the canvas.
- **Easing:** Linear, Ease In/Out, In&Out, Expo, Back, Snap, Bounce, Elastic, Steps and Hold, plus a draggable cubic-bezier editor that allows overshoot.
- **Timeline:** pan to scrub under the centre playhead, drag clips to move them (keys move too), trim clip ends, drag diamonds to retime keys, zoom, and per-property key rows.
- **Timeline touch gestures (Alight-Motion style):** the timeline is a virtual canvas that isn't clamped to the project. Swipe anywhere to pan in x/y with momentum: clips, keyframes, empty space below the tracks, and past the project end. The extent grows as you pan or drag, and panning left of 0 rubber-bands back. The region past the end is shaded, with a draggable END marker that sets the duration. While a layer is selected, panning is horizontal only; tap empty track space to deselect. Tap selects. Moving a clip or keyframe always takes a long-press (~0.3 s): it pops and glows, then you drag it left or right in time. The selected clip's trim handles drag directly. Dragging near the left or right edge auto-scrolls. Clips can run past the end (start ≥ 0), and playback and export stop at the duration. The ruler pans too (the centre playhead scrubs). Pinch with two fingers to zoom time (ctrl/trackpad-pinch on desktop). The page shell is locked, so it never scrolls or rubber-bands.
- **⋯ layer menu** (dropdown under the ⋯ button, like Alight): Save to My Elements, Parent to Layer / Release Parent, Group / Ungroup, Flip Horizontally / Vertically, Fit / Fill / Stretch to Composition Area, Create Clipping Mask (the layer shows only inside the layer below), Convert to Outline (shapes), colour-tag swatches for the timeline clip, plus Center, Hide, Lock, Move up / down, Easing and Rename. Tap outside to close.
- **Deselect:** a short tap on empty space (preview outside any layer, the dark area around it, empty timeline space) deselects; pans, long presses and pinches don't.
- **Canvas gestures:** drag to move, use the corner handle to scale and the knob to rotate, pinch with two fingers to scale and rotate, with snapping to centre.
- **183 effects in 12 categories** (Color & Light 29, Drawing & Edge 17, Blur 18, Distortion/Warp 27, Procedural 23, 3D 19, Move/Transform 12, Repeat 7, Matte/Mask/Key 11, Opacity/Visibility 7, Text 6, Other 7). They run on a WebGL1 engine (`js/fx/`) with original shaders: pyramid blurs, bloom, true 3D primitives, keying, procedural noise, text animators, and time effects such as motion blur, echo and time quantization. Every parameter can be keyframed, and preview and export render the same. Effects are added from an Add Effect browser with a carousel, category pages, live search with tags, and a preset sheet (Standard Settings, Transition In/Out Fast/normal, plus effect-specific presets). They sit in collapsible cards with a ⋯ menu (Reset to Defaults, Duplicate, Copy/Paste Effect, Effect Details) and ruler + value-box parameters. The Easing Curve panel opens from the graph button (Curve / Physics / Steps presets, draggable bezier handles, a yellow dot at the playhead), and "Keyframes Required" appears when there are fewer than two keys. Alight's Parenting Helper is left out. Projects that used the old effects are migrated.
- **20 blend modes:** normal, add, screen, lighten, dodge, multiply, darken, burn, overlay, soft/hard light, difference, exclusion, hue, saturation, color, luminosity, clip-to-below, alpha mask and cut-out.
- **Undo/redo**, with autosave to `localStorage` (media goes in IndexedDB), a projects list, and JSON save/load with media embedded.
- **Export:** every frame is rendered at its exact time and encoded with WebCodecs: **MP4 (H.264)** and **WebM (VP9)**, at 480p–4K and 12–60 fps, with a bitrate setting. The soundtrack is mixed offline, including speed, reverse, volume keys and fades. You can also export an **animated GIF** or a **PNG sequence (ZIP)**, and WebM, GIF and PNG can keep a **transparent background**. Browsers without WebCodecs fall back to real-time MediaRecorder recording. On iOS you can save to Photos via Share, and there is a PNG export of the current frame. The muxers are vendored from `mp4-muxer` / `webm-muxer` (MIT, licences in `js/vendor/`).
- **Animation depth (Alight parity):** keyframes on colours, border, shadow, text size, tracking and box width, and solid and gradient colours; pivot point, Scale X / Y and skew; 3D layers (Z, Rotate X / Y with perspective) and a camera layer (pan, dolly, roll, zoom); groups, null objects and parenting; track-matte masks (alpha / luma, invert); bezier vector points; project-wide motion blur.
- **Clips & audio:** split and trim cut into the source; Speed 0.1–8× and Reverse; waveforms on audio and video clips; keyframeable volume with fade in / out; Add Beat Markers; timeline markers.
- **Keyframes:** copy and paste them at the playhead (across layers), Select All, and drag a selection to move it together. Ctrl/⌘ C / V / D / A shortcuts, arrow keys to nudge, and , / . to step frames.
- **More:** import your own fonts (TTF / OTF / WOFF) and use more built-in font stacks; an eyedropper and recent-colour swatches on every colour field; a smudge brush; text paragraph boxes and gradient text; Save to My Elements and insert them anywhere; place another project as a nested element; Share Project as a `.kntc.json`.
- **PWA:** manifest, icons and an offline service worker.

## Run locally
No build step is needed. Serve the folder statically:
```
python3 -m http.server 8765   # then open http://localhost:8765
```

## Tests
Playwright (Chromium) runs in two modes: desktop at 1440×900, and iPhone emulation at 440×956 with touch and DPR 3.
```
python3 tests/e2e.py        # full feature suite, desktop + iPhone
python3 tests/gestures.py   # timeline touch gestures with real touch input (440×956)
python3 tests/effects.py    # Add Effect browser, search, presets, cards/menu, easing, every effect renders, preview/export parity
python3 tests/fxcompile.py  # compiles every effect shader
python3 tests/gaps.py       # Alight-parity features: trims, style keys, pivot, audio, speed, key clipboard, bezier, export formats, groups, masks, fonts, 3D …
python3 tests/build_thumbs.py  # rebuilds icons/fx-thumbs.webp + js/fx/thumbs.js + /workspace/kntc-shots/effects/contact-sheet.png
python3 tests/fx_shots.py   # before/after shots of key effects -> /workspace/kntc-shots/effects
python3 tests/shots.py      # iPhone screenshots -> /workspace/kntc-shots (+ compare/ vs reference/ if present)
```
The suite covers layer creation, keyframes and interpolation, easing, every effect, blend modes, undo/redo, persistence, JSON round-trip, media import, WebM and MP4 export (checking the output decodes), canvas dragging and the PWA manifest.

## Structure
`js/state.js` (model, keyframes, history) · `js/easing.js` · `js/fx/*.js` (WebGL engine + effect definitions) · `js/effects.js` (search, presets, transform/text/shape effect hooks, migration) · `js/fxui.js` (Effects panel, browser, Easing Curve) · `js/fxsample.js` (sample scenes for thumbnails/tests) · `js/render.js` (compositor) · `js/export.js` (WebCodecs / GIF / PNG-ZIP / real-time export) · `js/gif.js` · `js/vendor/` (MIT muxers) · `js/storage.js` · `js/ui.js` · `js/main.js` (UI/timeline/panels)
