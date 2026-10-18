# KINETIC // motion

A mobile-first, browser-only motion-graphics editor — layers, keyframes, easing curves, WebGL effects, blend modes and video export.
Built as a personal tool for iPhone Safari (add it to your Home Screen) that works just as well on desktop.

**Live:** https://sfxhewitt.github.io/motion-web/

> Personal, non-commercial project inspired by the *workflow* of mobile motion editors (such as Alight Motion).
> It has no affiliation with them, and it contains none of their code, assets, shaders, icons or fonts. Every visual and shader here is original.

## Features
- **Canvas presets:** 9:16, 16:9, 1:1, 4:5 and 4:3, plus FPS (24/25/30/60), duration and background colour.
- **Layers:** shapes (rect, ellipse, triangle, star, polygon, ring, line) with solid/gradient fill and stroke; multi-line text with font, weight, tracking and stroke; solids with gradients; imported images and video; and adjustment layers that apply effects to everything below them.
- **Keyframes:** position X/Y, scale, rotation and opacity. Use ◆ per property, or KEY to keyframe them all at the playhead. Once a property is animated, any edit you make creates a keyframe. A motion path is drawn on the canvas.
- **Easing:** Linear, Ease In/Out, In&Out, Expo, Back, Snap, Bounce, Elastic, Steps and Hold, plus a draggable cubic-bezier editor that allows overshoot.
- **Timeline:** scrub the ruler, drag clips to move them (keys move too), trim clip ends, drag diamonds to retime keys, zoom, and per-property key rows.
- **Canvas gestures:** drag to move, use the corner handle to scale and the knob to rotate, pinch with two fingers to scale and rotate, with snapping to centre.
- **21 effects** (WebGL, original shaders): Gaussian/Motion/Zoom Blur, Neon Glow, Color Adjust (with hue cycling), Duotone, Invert, Posterize, Chromatic Split (pulsing), Glitch, Pixelate, CRT Scanlines, Grain, Vignette, Wave Warp, Swirl, Kaleidoscope, Mirror, and the motion effects Shake, Pulse Scale and Auto Spin. Effects stack, and you can toggle and reorder them.
- **20 blend modes:** normal, add, screen, lighten, dodge, multiply, darken, burn, overlay, soft/hard light, difference, exclusion, hue, saturation, color, luminosity, clip-to-below, alpha mask and cut-out.
- **Undo/redo**, with autosave to `localStorage` (media goes in IndexedDB), a projects list, and JSON save/load with media embedded.
- **Export:** MediaRecorder renders in real time at 480p–4K, 24–60 fps, with a bitrate setting. You get **MP4 (H.264) on Safari** and WebM (or MP4 on recent Chrome) elsewhere, and video-layer audio is mixed in. On iOS you can save to Photos via Share. There is also a PNG export of the current frame.
- **PWA:** manifest, icons and an offline service worker.

## Run locally
No build step is needed. Serve the folder statically:
```
python3 -m http.server 8765   # then open http://localhost:8765
```

## Tests
Playwright (Chromium) runs in two modes: desktop at 1440×900, and iPhone emulation at 440×956 with touch and DPR 3.
```
python3 tests/e2e.py
```
The suite covers layer creation, keyframes and interpolation, easing, every effect, blend modes, undo/redo, persistence, JSON round-trip, media import, WebM and MP4 export (checking the output decodes), canvas dragging and the PWA manifest.

## Structure
`js/state.js` (model, keyframes, history) · `js/easing.js` · `js/effects.js` (catalogue + WebGL pipeline) · `js/render.js` (compositor) · `js/export.js` · `js/storage.js` · `js/ui.js` · `js/main.js` (UI/timeline/panels)
