import { buildPath, Command } from "@owlbear-rodeo/sdk";

/**
 * Single source of truth for our namespace. Every metadata key is derived
 * from this so we can always find our own items and never touch anyone else's.
 */
export const ID = "com.github.gizmo73.travel-day-hex";
export const OVERLAY_KEY = `${ID}/overlay`;
export const SETTINGS_KEY = `${ID}/settings`;

export const HEXES_ACROSS_MIN = 2;
export const HEXES_ACROSS_MAX = 50;

/**
 * Hard ceiling on hexes. Hexes are batched into path items rather than drawn
 * one item each, so this is bounded by the size of the scene document rather
 * than by item count.
 */
export const MAX_HEXES = 30000;

/**
 * Hexes per path item. One Path holds many subpaths, so a scene needing tens of
 * thousands of hexes costs tens of items instead of tens of thousands.
 */
const HEXES_PER_ITEM = 500;

/**
 * Ceiling on loop iterations while scanning an extent. Guards against an
 * absurd extent spinning for a long time before we can reject it.
 */
const MAX_SCAN = 5_000_000;

export const DEFAULTS = {
  enabled: false,
  // Empty means "use every map image in the scene". Otherwise these item ids
  // define the extent, so a scene holding several maps can be overlaid on just
  // the ones you choose rather than on their combined bounding box.
  boundsItemIds: [],
  hexesAcross: 8, // 24-mile hexes over a 3-mile grid
  strokeColor: "#FFCC00",
  strokeWidth: 8,
  // Origin nudge, measured in scene grid cells rather than pixels so the
  // offset survives a DPI change instead of drifting.
  offsetX: 0,
  offsetY: 0,
};

const SQRT3 = Math.sqrt(3);

export function isHexGrid(gridType) {
  return gridType === "HEX_VERTICAL" || gridType === "HEX_HORIZONTAL";
}

/**
 * Circumradius (centre to corner) of one scene grid cell.
 *
 * OBR defines dpi as the cell WIDTH for HEX_VERTICAL (pointy-top, taller than
 * wide) and the cell HEIGHT for HEX_HORIZONTAL (flat-top, wider than tall).
 * Both of those measurements equal sqrt(3) * circumradius, so the conversion
 * is the same expression for either orientation.
 */
export function cellRadius(dpi) {
  return dpi / SQRT3;
}

/** Axial hex coordinate -> centre point, for a hex of the given circumradius. */
export function axialToPixel(q, r, radius, gridType) {
  if (gridType === "HEX_HORIZONTAL") {
    // Flat-top: columns march along x, rows shear down y.
    return {
      x: radius * 1.5 * q,
      y: radius * ((SQRT3 / 2) * q + SQRT3 * r),
    };
  }
  // Pointy-top: rows march along x, columns shear down y.
  return {
    x: radius * (SQRT3 * q + (SQRT3 / 2) * r),
    y: radius * 1.5 * r,
  };
}

/** Inverse of axialToPixel. Returns fractional axial coordinates. */
export function pixelToAxial(x, y, radius, gridType) {
  if (gridType === "HEX_HORIZONTAL") {
    return {
      q: ((2 / 3) * x) / radius,
      r: ((-1 / 3) * x + (SQRT3 / 3) * y) / radius,
    };
  }
  return {
    q: ((SQRT3 / 3) * x - (1 / 3) * y) / radius,
    r: ((2 / 3) * y) / radius,
  };
}

/**
 * Round fractional axial coordinates to the nearest whole hex.
 *
 * Rounding q and r independently picks the wrong hex near cell edges, so this
 * rounds in cube space and rebuilds whichever axis drifted furthest.
 */
export function axialRound(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;

  return { q: rx, r: rz };
}

/**
 * The origin nudge that puts an overlay hex centre exactly on `point`.
 *
 * Finds the nearest hex of the un-nudged lattice and returns the gap to the
 * chosen point, so the result is always the smallest nudge that lands the
 * alignment: at most half the centre spacing, or hexesAcross / 2 cells.
 * Returned in grid cells to match how the offset is stored.
 */
export function offsetToCentreOn(point, dpi, hexesAcross, gridType) {
  const radius = cellRadius(dpi) * hexesAcross;
  const fractional = pixelToAxial(point.x, point.y, radius, gridType);
  const { q, r } = axialRound(fractional.q, fractional.r);
  const centre = axialToPixel(q, r, radius, gridType);
  return {
    x: (point.x - centre.x) / dpi,
    y: (point.y - centre.y) / dpi,
  };
}

/** The six corners of a hex centred on the origin, in draw order. */
export function hexCorners(radius, gridType) {
  // Flat-top has a corner at 0 degrees; pointy-top is rotated back 30 degrees.
  const start = gridType === "HEX_HORIZONTAL" ? 0 : -Math.PI / 6;
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = start + i * (Math.PI / 3);
    corners.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return corners;
}

/**
 * Walk every overlay hex whose centre lands inside `bounds` grown by one hex of
 * margin, so the overlay runs past the edge of the map rather than stopping
 * short of it.
 *
 * Returns false without visiting anything if the extent is too large to scan.
 */
function forEachCentre(box, radius, gridType, offset, visit) {
  const bounds = box;
  const margin = radius * 2;
  const min = { x: bounds.min.x - margin, y: bounds.min.y - margin };
  const max = { x: bounds.max.x + margin, y: bounds.max.y + margin };

  // The axial axes are sheared relative to the bounding box, so take the axial
  // coordinate of all four corners and pad the resulting range to cover it.
  const corners = [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: min.x, y: max.y },
    { x: max.x, y: max.y },
  ];

  let qMin = Infinity;
  let qMax = -Infinity;
  let rMin = Infinity;
  let rMax = -Infinity;
  for (const corner of corners) {
    const { q, r } = pixelToAxial(
      corner.x - offset.x,
      corner.y - offset.y,
      radius,
      gridType,
    );
    qMin = Math.min(qMin, q);
    qMax = Math.max(qMax, q);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }

  const rFrom = Math.floor(rMin) - 2;
  const rTo = Math.ceil(rMax) + 2;
  const qFrom = Math.floor(qMin) - 2;
  const qTo = Math.ceil(qMax) + 2;
  if ((rTo - rFrom + 1) * (qTo - qFrom + 1) > MAX_SCAN) return false;

  for (let r = rFrom; r <= rTo; r++) {
    for (let q = qFrom; q <= qTo; q++) {
      const centre = axialToPixel(q, r, radius, gridType);
      const x = centre.x + offset.x;
      const y = centre.y + offset.y;
      if (x < min.x || x > max.x || y < min.y || y > max.y) continue;
      visit(q, r, x, y);
    }
  }
  return true;
}

/**
 * Every overlay hex centre covering the given boxes.
 *
 * Each map gets its own box rather than the whole scene getting one bounding
 * box, so maps sitting far apart are covered individually instead of the empty
 * canvas between them being filled in too. Every box draws from the same
 * lattice, keyed by axial coordinate, so hexes still line up across maps and
 * overlapping boxes share hexes rather than stacking duplicates.
 */
export function overlayCentres(boxes, radius, gridType, offset) {
  const seen = new Map();
  for (const box of boxes) {
    forEachCentre(box, radius, gridType, offset, (q, r, x, y) => {
      const key = `${q},${r}`;
      if (!seen.has(key)) seen.set(key, { x, y });
    });
  }
  return [...seen.values()];
}

/**
 * How many hexes the boxes need, without building any of them, so the caller
 * can refuse an oversized overlay instead of silently drawing a truncated one.
 * Infinity when the extent is too large even to scan.
 */
export function countOverlayCentres(boxes, radius, gridType, offset) {
  const seen = new Set();
  for (const box of boxes) {
    const scanned = forEachCentre(box, radius, gridType, offset, (q, r) => {
      seen.add(`${q},${r}`);
    });
    if (!scanned) return Infinity;
  }
  return seen.size;
}

/**
 * Build the overlay as ordinary scene items.
 *
 * Note on geometry: overlay hex edges will cut through the small scene hexes.
 * That is unavoidable, not a bug. A regular hexagon cannot be tiled by smaller
 * regular hexagons, and 8-across in particular has no clean fit. One overlay
 * hex is centred on the scene origin so the big hexes at least sit centred on
 * small ones; the origin nudge shifts that alignment to taste.
 */
export function buildOverlayItems({ dpi, gridType, boxes, settings }) {
  const smallRadius = cellRadius(dpi);
  const bigRadius = smallRadius * settings.hexesAcross;
  const offset = {
    x: settings.offsetX * dpi,
    y: settings.offsetY * dpi,
  };

  const corners = hexCorners(bigRadius, gridType);
  const centres = overlayCentres(boxes, bigRadius, gridType, offset);

  // Two decimals is well under a pixel at any sane zoom, and keeps the command
  // list from bloating the scene document.
  const round = (n) => Math.round(n * 100) / 100;

  const items = [];
  for (let start = 0; start < centres.length; start += HEXES_PER_ITEM) {
    const batch = centres.slice(start, start + HEXES_PER_ITEM);
    const commands = [];
    for (const centre of batch) {
      commands.push([
        Command.MOVE,
        round(centre.x + corners[0].x),
        round(centre.y + corners[0].y),
      ]);
      for (let i = 1; i < corners.length; i++) {
        commands.push([
          Command.LINE,
          round(centre.x + corners[i].x),
          round(centre.y + corners[i].y),
        ]);
      }
      commands.push([Command.CLOSE]);
    }
    items.push(
      buildPath()
        .commands(commands)
        .position({ x: 0, y: 0 })
        .fillOpacity(0)
        .strokeColor(settings.strokeColor)
        .strokeWidth(settings.strokeWidth)
        .strokeOpacity(1)
        .layer("DRAWING")
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .name("Travel Day Hex")
        .metadata({ [OVERLAY_KEY]: true })
        .build(),
    );
  }
  return items;
}

/** Hexes the current settings would need for this extent. */
export function overlayHexCount({ dpi, gridType, boxes, settings }) {
  const radius = cellRadius(dpi) * settings.hexesAcross;
  const offset = { x: settings.offsetX * dpi, y: settings.offsetY * dpi };
  return countOverlayCentres(boxes, radius, gridType, offset);
}

/** Fallback extent when the scene has no map images to measure. */
export function fallbackBounds(dpi, hexesAcross) {
  const half = cellRadius(dpi) * hexesAcross * 6;
  return {
    min: { x: -half, y: -half },
    max: { x: half, y: half },
    width: half * 2,
    height: half * 2,
    center: { x: 0, y: 0 },
  };
}
