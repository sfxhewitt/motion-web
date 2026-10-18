# KINETIC — "Alight-style" layout map (v6, matched to real iPhone screenshots)

Goal: Josh is used to the Alight Motion phone app, so KINETIC copies its *look, layout and behaviour* (dark
navy UI, where things sit, generic menu names) — **not** its name, logo, watermark, bitmaps, icon files or its
music/template content. Every icon is an original SVG line icon drawn for KINETIC in the same line style; the
app name stays KINETIC.

## Sources
- Nine real iPhone screenshots (440x956 pt, 1500x3260 px) supplied by the user — kept locally in `reference/`
  (git-ignored, not redistributed): editor, add sheet (Shape / Media / Audio / Object / Template), layer
  selected, Edit Points, Drawing. Colours below were **sampled with PIL** from those images.
- `python3 tests/shots.py` renders ours at the same size and writes side-by-side comparisons
  (reference left, KINETIC right) to `/workspace/kntc-shots/compare/` when `reference/` exists.

## Palette (sampled)
| Token | Value | Where |
|---|---|---|
| `--bg` | `#191b27` | top bar, transport, timeline |
| `--stage` | `#141720` | preview surround |
| `--panel` | `#202332` | bottom panel (layer selected / sub panels) |
| `--tile` | `#282d40` | tiles, layer pills, ruler pill |
| `--sheet` | `#2b2e3d` | add sheet tab row + right column (grid area is black) |
| `--field` | `#333750` | number boxes (cyan values `#5ccfe6`) |
| `--pad` | `#272a3d` | Edit Points trackpad |
| `--tcpill` | `#313547` | timecode pill over the playhead |
| `--ac` | `#00ffa8` | mint accent: export button, + FAB outline, active sheet tab, slider fill, active tool |
| `--clip` | `#2a7fe4` | shape clip blue (drawing `#9886d7`, audio `#1fa58a`) |
| text | `#fff` / `#a9abb6` / `#6f7385`, tile labels `#7c7f91` | |

Font: system sans (SF on iPhone). Icons: 24 viewBox, ~1.6px round-cap strokes.

## Layout
### Editor (nothing selected) — `body[data-mode=none]`
1. Top bar: `<` back (to projects) · editable project name · ⚙ project settings · mint export button.
2. Full-width preview on a dark background.
3. Transport row: undo · redo · go-to-start · play · go-to-end · duplicate layer · fit/fullscreen preview.
4. Timeline with a **fixed centre playhead**: the tracks scroll underneath it (`scrollLeft == t * pps`, t = 0 at
   the centre); ruler with a `mm:ss:ff` timecode pill centred on the playhead; layer rows = rounded pill on the
   left (eye + thumbnail, sticky) + clip strip. Past-end region shaded with a draggable END marker.
5. Mint outlined **+** FAB bottom right; no toolbar.
### + sheet (`#sheet`)
Tabs **Shape · Media · Audio · Object / Element · Template** (active = mint); right column **Freehand Drawing ·
Vector Drawing · Text · ✕**. Shape = paged grey shape grid (2 x 15, own shape set). Media = import + project
media; Audio = import audio files + project audio; Object = Solid Color, Adjustment, Camera / Empty Group / Null /
Element (last four "coming soon"); Template = Demo project (+ "coming soon" browse).
### Layer selected — `data-mode=sel`
Top bar: `<` · layer name · duplicate · trash · ⋯ (layer menu). The clip becomes a white pill with `<` / `>` trim
caps; the row scrolls to the top. Tile grid: small tiles (speed — soon, trim start, split, trim end, mute), then
**Color & Fill · Border & Shadow · Blending & Opacity**, **Move & Transform · Edit Shape/Text/Media · Presets
(soon) · Effects**, then Easing / layer up / down / lock.
### Sub panels — `data-mode=sub`
Title in the top bar (+ ◆ keyframe-all button), left column with `<` back and tools, body on the right.
- **Edit Points** (vector drawing / "Convert to Points"): tap the preview to add points, drag them; trackpad +
  X/Y inputs position the next point; close-path toggle; ⊕ in the top bar adds a point at the cursor.
- **Drawing** (freehand layer): size slider, hex colour bar + 14 swatches, eyedropper / clear / palette; right
  column pencil · brush · smudge (soon) · eraser.

## Behaviour
- New layers go **on top** (index 0 = top row = rendered last).
- Timeline gestures kept: pan anywhere (incl. ruler, which now scrubs via the centre playhead), axis lock +
  momentum, long-press to move clips / keyframes, edge auto-scroll, END marker, rubber band at 0, pinch zoom
  about the playhead; with a layer selected panning is horizontal-only. iOS safe areas respected.

## Knowingly different
- Name, logo, icons and shape set are KINETIC's own; no watermark, music or template library.
- Camera, Empty Group, Null, Elements, Templates browse, Presets, Speed and Smudge are "coming soon" toasts.
- Edit Points is simplified (straight segments, no bezier handles); no preview zoom (magnifier) button.
- Selection overlay keeps a rotate handle + square scale handle (Alight shows only dots).
- Keyframe easing editor (bezier) is KINETIC's own.
