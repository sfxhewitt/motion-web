# KINETIC — "Alight-style" reskin: layout map

Goal: Josh is used to the Alight Motion phone app, so KINETIC copies its *look and layout* (dark grey UI,
where things sit, generic menu names) — **not** its name, logo, bitmaps or icon files. Every icon here is an
original SVG line icon drawn for KINETIC; the app name stays KINETIC.

## Sources (public)
- alightmotion.com feature list: layers of graphics/video/audio, vector shapes, keyframes for all settings,
  easing presets + custom curves, "Solid color, gradient, and media fill", "Stroke, Shadow, and Multi-Border".
- App Store listing (apps.apple.com/gb/app/alight-motion/id1438955848) — page returned 404 to our fetcher, so
  screenshots were not inspected directly; layout below is from tutorials/guides + general familiarity.
- Tutorial / guide write-ups (e.g. themotionalight.com interface tour, skkarthicreation.com 3.1.4 walkthrough,
  community docs kuchingneko28.github.io/alight-motion-docs): large **+** on the home screen opens the new
  project dialog (ratio, resolution, frame rate, background, name); in the editor the **+** at the bottom right
  adds Shapes, Image & Video, Audio, Elements, Freehand Drawing, Vector Drawing, Text; a selected layer offers
  **Move & Transform, Color & Fill, Border & Shadow, Blending & Opacity, Effects** (+ Edit Text for text);
  blending groups Normal / Darken / Lighten / Contrast / Difference / Color / Mask; settings (fps, background)
  under the top-right gear in the editor.

## Visual style
| Token | Value | Notes |
|---|---|---|
| background | `#121212` | near-black app background |
| panel / sheet | `#1e1e1e`, raised `#2a2a2a`, pressed `#333` | flat grey panels, no gradients/glow |
| hairline | `#2f2f2f` | 1px separators |
| text | `#ffffff` / secondary `#a8a8a8` / tertiary `#6e6e6e` | |
| accent | `#3d8bff` (blue) | selection, playhead head, active toggles, + button. Approximate — chosen by eye, not sampled |
| keyframe | `#ffcc33` diamonds | |
| END / past-end | dimmed + orange line (kept from 6f4ce3f) | |
| font | system sans (SF on iPhone), titles 16/600, labels 13/500, values 12/400, captions 11/400 | no monospace/uppercase-tracking |
| radius | sheets 14px top corners, cards 10px, buttons 8px, clips 6px, FAB round | |
| spacing | 8px grid; 44px touch targets; toolbar items 64px wide | |
| icons | 24 viewBox, 1.8px round-cap line strokes, no fills | original drawings |

## Layout map
### Home (project list) — `#home`
- Top bar: wordmark **KINETIC** left; **settings gear** top-right (about / storage / import).
- Segmented tabs under it: **Projects** | **Elements** (Elements = disabled placeholder).
- Project cards: thumbnail left (aspect-shaped), name, "9:16 · 6.0s · date", ⋯ menu (Delete) right.
- Big round **+** floating at the bottom centre → New Project sheet (aspect ratio grid, Create).

### Editor
1. **Top bar** `#top`: ← back (to project list) · project title · undo · redo · ⚙ project settings · export/share icon.
2. **Preview** `#stageWrap`: canvas centred on dark grey, no grid glow.
3. **Play bar** `#transport`: play/pause left, timecode `00:01.60 / 00:06.00`, keyframe ◆ button, zoom, loop.
4. **Timeline** `#timeline`: layer rows with a type icon + name on the left, clip bars as rounded grey/blue
   bars, white playhead line with blue head, ruler on top, END marker. Gestures unchanged.
5. **Bottom toolbar** `#tabs`: round blue **+** (Add) first, then horizontally scrollable icon+label items:
   **Move & Transform, Color & Fill, Border & Shadow, Effects, Blending & Opacity, Keyframes**.
6. **Property sheet** `#panel`: slides up between timeline and toolbar with a header (title + ✓ close).

### Add (+) menu
Sections **Shapes** (rect, ellipse, triangle, star, polygon, ring, line), **Media** (Image & Video), **Text**,
**Audio** (disabled: not supported yet), **Element** (Solid, Adjustment, Demo).

## Knowingly different
- Name, logo, wordmark, icons are original. Accent colour approximated.
- No Audio layers, drawing tools, Elements library or account/cloud — shown disabled or omitted.
- Keyframe easing editor (bezier) is KINETIC's own; Alight's graph UI differs.
- Toolbar always lists all categories (also with nothing selected; panels then say "Select a layer").
