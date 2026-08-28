import { buildCurve } from "@owlbear-rodeo/sdk";

/**
 * Single source of truth for our namespace. Every metadata key is derived
 * from this so we can always find our own items and never touch anyone else's.
 */
export const ID = "com.github.gizmo73.travel-day-hex";
export const OVERLAY_KEY = `${ID}/overlay`;
export const SETTINGS_KEY = `${ID}/settings`;

export const HEXES_ACROSS_MIN = 2;
export const HEXES_ACROSS_MAX = 50;

/** Hard ceiling so a silly hexesAcross value can never flood a scene. */
const MAX_ITEMS = 4000;

export const DEFAULTS = {
  enabled: false,
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
 * Every overlay hex whose centre lands inside `bounds` grown by one hex of
 * margin, so the overlay runs past the edge of the map rather than stopping
 * short of it.
 */
export function overlayCentres(bounds, radius, gridType, offset) {
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

  const centres = [];
  for (let r = Math.floor(rMin) - 2; r <= Math.ceil(rMax) + 2; r++) {
    for (let q = Math.floor(qMin) - 2; q <= Math.ceil(qMax) + 2; q++) {
      const centre = axialToPixel(q, r, radius, gridType);
      const x = centre.x + offset.x;
      const y = centre.y + offset.y;
      if (x < min.x || x > max.x || y < min.y || y > max.y) continue;
      centres.push({ x, y });
      if (centres.length >= MAX_ITEMS) return centres;
    }
  }
  return centres;
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
export function buildOverlayItems({ dpi, gridType, bounds, settings }) {
  const smallRadius = cellRadius(dpi);
  const bigRadius = smallRadius * settings.hexesAcross;
  const offset = {
    x: settings.offsetX * dpi,
    y: settings.offsetY * dpi,
  };

  const corners = hexCorners(bigRadius, gridType);
  const centres = overlayCentres(bounds, bigRadius, gridType, offset);

  return centres.map((centre) =>
    buildCurve()
      .points(corners)
      .position(centre)
      .tension(0)
      .closed(true)
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
