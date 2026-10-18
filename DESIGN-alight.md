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
A short tap on empty space (preview outside any layer, the dark surround, empty timeline space beside / below the
rows; not the ruler or the tile grid) deselects back to the mint **+**; pans, long presses and pinches don't.
### ⋯ layer menu (`reference/14-layer-menu.jpg`)
Dropdown anchored under ⋯ (arrow pointing at it), not a modal: slate `#35374e` rounded popover, system font 17px
white, labels that don't fit auto-shrink (Stretch… ≈13px), 3px `#212236` dividers. **Save to My Elements (soon) ·
Flip Horizontally · Flip Vertically · Fit / Fill / Stretch to Composition Area** | **Create (Release) Clipping Mask
· Convert to Outline** | sideways-scrolling colour-tag swatches (X = none, `#e34829`, `#c8495c`, `#da8d57`,
`#faeb90`, `#8be1d4`, blue, indigo, purple, grey; they colour the timeline clip) | KINETIC extras: Center on Canvas
· Hide · Lock · Move Up / Down · Easing · Rename. Tap outside (swallowed) or Esc closes. Flips are `flipX/flipY`
(scale −1); a clipping mask (`clip: true`) draws the layer only where the layer directly below is (runs of
clipped layers share the base; clipped rows get an indented pill).
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
- Camera, Empty Group, Null, Elements, Templates browse, Speed and Smudge are "coming soon" toasts.
- Edit Points is simplified (straight segments, no bezier handles); no preview zoom (magnifier) button.
- Selection overlay keeps a rotate handle + square scale handle (Alight shows only dots).
- Keyframe easing editor (bezier) is KINETIC's own.

## Home screen & Create sheet (v7, LIGHT theme — matched to `reference/10-home.jpg`, `11-create.jpg`)
The editor stays dark; only the home screen, the Create sheet and dialogs opened from home are light.
Font for these screens: **Space Grotesk** (SIL OFL, bundled subset `fonts/SpaceGrotesk.woff2`, licence `fonts/OFL.txt`).

| Token | Value | Where |
|---|---|---|
| `--l-bg` | `#f5f5f5` | home background / top bar |
| `--l-card` | `#ffffff` | banner, project cards, inactive pills, bottom tab bar, dropdowns |
| `--l-navy` | `#202239` | active pill (Projects), active segment (Project) |
| `--l-mint` | `#74fbaf` | + FAB (glow), active ratio chip, segment text; Create button `#75faa7` |
| `--l-tag` | `#f8cd4d` | NEW tags (ink `#27221e`) |
| `--l-btn` | `#d7dcfc` | banner button (ink `#20223b`) |
| `--l-sheet` | `#ececee` | Create sheet; dim behind it = black @ 65% |
| ink | `#202237`, meta `#b0b0b4`, inactive pills `#b4b4ba`, duration badge `#22223c` | |

Layout (pt, 440 wide): top bar 58 (hamburger · centred KINETIC wordmark + own swoosh mark · 30pt avatar);
banner 104 tall r13; pills 40 tall r10, gap 13; cards 110 tall r12, gap 15, 96pt thumbnail with duration badge,
name 17/600, 2×2 meta grid (ratio · resolution / size · fps); bottom tab bar 79 + safe area with a 56pt FAB
riding 11pt above it. Create sheet: r22 top corners, X + "Create" 27/600, segmented Project | Element (44),
name field with clear button and underline, ratio chips 16:9 · 9:16 · 4:5 · 1:1 · 4:3 · custom (corner-bracket
outlines), Resolution / Frame Rate / Background dropdowns (232×44, r12) and a 52pt "Create from scratch" button.
The Create sheet really creates the project: resolution = short side (480–2160), fps and background colour
are stored on the project; export defaults to the project's resolution and fps.

## Timeline layer rows (v9 — matched to `reference/15-timeline-layers.jpg`, 1320×2868 = 3× of 440pt)
| Item | Value |
|---|---|
| row pitch | 32pt (96px) |
| pill | 69×29pt, `#262835`, radius 0 14.5 14.5 0, 3pt gap; eye 22pt at x≈17, thumbnail 21pt at x≈48 = the layer's own shape/media in its colours on transparent |
| clip | 26pt tall, 6pt gap, `#65abcd` + `rgba(255,255,255,.035)` 10/20pt stripes, 2.5pt radius, 1px `#072235` outline, name 14/500 white, 6pt inset |
| media clip | filmstrip of the media at its own aspect, clip height, 3px dark gap |
| ☰ handle | pinned 4pt from the right edge of the view (sticky), 3 bars 14×2.2 gap 5; grey `#4a4c58` over empty track, black@40% over a clip; vertical drag reorders right away, horizontal swipe pans |
| ruler band | opaque to 29pt, fades out by 38pt so rows scrolled up show under the timecode |
Newest layer is the top row; the list scrolls vertically.

## ⧉ copy menu (v9 — `reference/16-copy-menu.jpg`)
245pt wide, `#35374e`, radius 20, 10pt from the right edge, arrow pointing down at ⧉; rows 45pt with 1px `#1f2233`
dividers, 26pt outline icons (dotted squares = clipboard), 17pt labels, disabled `#717284`, NEW badge `#f7cc4a`.
Select All Layers (multi-select, clips outlined white) · Duplicate Layer · Copy Layer (including style) · Save Preset
(→ Presets tile) · Paste Layer (on top) · Paste Style ▸ All / Fill / Border / Shadow / Effects / Blending / Opacity.
Clipboard `kntc.clipboard` and presets `kntc.presets` live in localStorage.
