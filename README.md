# Travel Day Hex

An [Owlbear Rodeo](https://owlbear.rodeo) extension that draws a bold secondary hex
grid over a scene's existing hex grid.

The use case is a hexcrawl map with 3-mile hexes. Overlay 24-mile hexes on top and a
GM can eyeball one day of travel at a glance, then drop back to the 3-mile grid for
exact timing.

## Install

Paste this URL into Owlbear Rodeo's **Add Extension** box:

```
https://gizmo73.github.io/24-mile-hex-owlbear/manifest.json
```

Then open the **Travel Day Hex** action in the toolbar.

## How it works

The overlay is drawn as ordinary locked scene items on the drawing layer, which means
it is purely decorative: measurement, snapping, and every built-in tool keep working
against the scene's own grid. Tokens still snap to 3-mile hexes, and the ruler still
reports 3-mile distances.

Everyone in the room sees the overlay. Only the GM can change it.

## Settings

Settings live in scene metadata, so each map remembers its own overlay.

| Setting | Default | Notes |
| --- | --- | --- |
| Show overlay | off | Toggles the whole overlay |
| Hexes across | 8 | Small hexes per big hex. 8 gives 24 miles over a 3-mile grid |
| Colour | `#FFCC00` | Stroke colour |
| Line weight | 3x the scene's grid line width | Stroke width, 1&ndash;30 |
| Origin nudge X / Y | 0 | Shifts the overlay, measured in grid cells so it survives a DPI change. Drag the slider, type an exact value, or align to a selected item |

### Aligning the overlay

Three ways to line the big hexes up with your map, in increasing order of precision:

1. **Drag the X / Y sliders.** The range scales with "hexes across", because a
   point can sit up to one overlay circumradius (`hexesAcross / sqrt(3)` cells)
   from the nearest big-hex centre.
2. **Type an exact value** into the box beside either slider.
3. **Align to a selected item.** Put a token on the small hex you want at the
   centre of a big hex, select it, and click *Align to selected item*. A token's
   bounds centre is already snapped to a hex centre, so this places a big-hex
   centre exactly there. Selecting several items aligns to the centre of the lot.

## Notes

- **Overlay edges cut through small hexes.** That is unavoidable geometry, not a bug.
  A regular hexagon cannot be tiled by smaller regular hexagons, and 8-across in
  particular has no clean fit. One overlay hex is centred on the scene origin so the
  big hexes sit centred on small ones; use the origin nudge to shift that to taste.
- The overlay only works on hex grids. On a square, isometric or dimetric scene the
  popover says so and draws nothing.
- The extent follows the map images in the scene, plus one hex of margin. A scene with
  no map images falls back to a fixed field around the origin.
- Redrawing happens while the popover is open. If you change the scene's grid with the
  popover closed, reopen it and the overlay rebuilds itself to match.

## Development

```bash
npm install
npm run dev      # then install the local manifest URL in Owlbear
npm run build
```

`vite.config.js` sets `base` to the repo name because GitHub Pages serves this from a
subpath rather than a domain root, and `public/manifest.json` uses absolute URLs for
`icon` and `popover` for the same reason.

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`.
