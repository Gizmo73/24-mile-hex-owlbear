import OBR from "@owlbear-rodeo/sdk";
import {
  DEFAULTS,
  HEXES_ACROSS_MAX,
  HEXES_ACROSS_MIN,
  OVERLAY_KEY,
  SETTINGS_KEY,
  buildOverlayItems,
  fallbackBounds,
  isHexGrid,
} from "./overlay.js";

const el = (id) => document.getElementById(id);

let role = "PLAYER";
let settings = { ...DEFAULTS };
let dpi = 150;
let gridType = "SQUARE";
let gridLineWidth = 2;
let sceneReady = false;

function debounce(fn, ms) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* ---------------------------------------------------------------- settings */

function readSettings(metadata) {
  const stored = metadata?.[SETTINGS_KEY];
  const merged = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  return {
    enabled: Boolean(merged.enabled),
    hexesAcross: clamp(
      Math.round(Number(merged.hexesAcross) || DEFAULTS.hexesAcross),
      HEXES_ACROSS_MIN,
      HEXES_ACROSS_MAX,
    ),
    strokeColor: /^#[0-9a-f]{6}$/i.test(merged.strokeColor)
      ? merged.strokeColor
      : DEFAULTS.strokeColor,
    strokeWidth: clamp(Math.round(Number(merged.strokeWidth) || DEFAULTS.strokeWidth), 1, 30),
    offsetX: clamp(Number(merged.offsetX) || 0, -3, 3),
    offsetY: clamp(Number(merged.offsetY) || 0, -3, 3),
  };
}

const writeSettings = debounce(async () => {
  if (role !== "GM") return;
  try {
    await OBR.scene.setMetadata({ [SETTINGS_KEY]: settings });
  } catch (err) {
    console.error("[travel-day-hex] could not save settings", err);
  }
}, 150);

/** Update local state now (so the UI stays responsive) and persist shortly after. */
function update(patch) {
  if (role !== "GM") return;
  settings = { ...settings, ...patch };
  syncInputs();
  scheduleRedraw();
  writeSettings();
}

/* ------------------------------------------------------------------ drawing */

async function clearOverlay() {
  // Only ever delete items carrying our own metadata key.
  const ours = await OBR.scene.items.getItems(
    (item) => item.metadata?.[OVERLAY_KEY] === true,
  );
  if (ours.length > 0) {
    await OBR.scene.items.deleteItems(ours.map((item) => item.id));
  }
}

async function resolveBounds() {
  const mapItems = await OBR.scene.items.getItems((item) => item.layer === "MAP");
  if (mapItems.length > 0) {
    try {
      const bounds = await OBR.scene.items.getItemBounds(mapItems.map((i) => i.id));
      const usable =
        bounds &&
        Number.isFinite(bounds.min?.x) &&
        Number.isFinite(bounds.max?.y) &&
        bounds.width > 0 &&
        bounds.height > 0;
      if (usable) return bounds;
    } catch (err) {
      console.warn("[travel-day-hex] falling back to a fixed extent", err);
    }
  }
  // No map images (or unmeasurable ones): cover a fixed 12x12 field of overlay
  // hexes around the origin rather than erroring.
  return fallbackBounds(dpi, settings.hexesAcross);
}

let redrawing = false;
let redrawQueued = false;

async function redraw() {
  // Players must never write to the scene; they just see what the GM drew.
  if (role !== "GM" || !sceneReady) return;
  if (redrawing) {
    redrawQueued = true;
    return;
  }
  redrawing = true;
  try {
    do {
      redrawQueued = false;
      // Always regenerate from scratch: delete our items, then rebuild.
      // Simpler than diffing and quick enough at these counts.
      await clearOverlay();
      if (settings.enabled && isHexGrid(gridType)) {
        const bounds = await resolveBounds();
        const items = buildOverlayItems({ dpi, gridType, bounds, settings });
        if (items.length > 0) await OBR.scene.items.addItems(items);
      }
    } while (redrawQueued);
  } catch (err) {
    console.error("[travel-day-hex] redraw failed", err);
  } finally {
    redrawing = false;
  }
}

// The offset sliders fire continuously; coalesce them into one redraw.
const scheduleRedraw = debounce(redraw, 150);

/* ----------------------------------------------------------------------- UI */

function syncInputs() {
  // Never fight the control the user is currently dragging or typing into.
  const active = document.activeElement;
  const set = (node, value) => {
    if (node !== active) node.value = value;
  };

  if (el("enabled") !== active) el("enabled").checked = settings.enabled;
  set(el("hexesAcross"), settings.hexesAcross);
  set(el("strokeColor"), settings.strokeColor);
  set(el("strokeWidth"), settings.strokeWidth);
  set(el("offsetX"), settings.offsetX);
  set(el("offsetY"), settings.offsetY);

  el("strokeWidthVal").textContent = settings.strokeWidth;
  el("offsetXVal").textContent = settings.offsetX.toFixed(2);
  el("offsetYVal").textContent = settings.offsetY.toFixed(2);
}

function syncStatus() {
  const status = el("status");
  document.body.classList.toggle("readonly", role !== "GM");

  if (!sceneReady) {
    status.className = "";
    status.textContent = "Open a scene to use the overlay.";
    return;
  }
  if (!isHexGrid(gridType)) {
    status.className = "warn";
    status.textContent =
      gridType === "SQUARE"
        ? "This scene uses a square grid. The overlay only works on hex grids."
        : `This scene uses a ${gridType.toLowerCase()} grid. The overlay only works on hex grids.`;
    return;
  }
  if (role !== "GM") {
    status.className = "";
    status.textContent = "You can see the overlay, but only the GM can change it.";
    return;
  }
  status.className = "";
  const across = settings.hexesAcross;
  status.textContent = settings.enabled
    ? `Overlay on: ${across} hexes across, ${gridType === "HEX_VERTICAL" ? "pointy-top" : "flat-top"} grid.`
    : "Overlay off.";
}

function bindInputs() {
  el("enabled").addEventListener("change", (e) => update({ enabled: e.target.checked }));

  el("hexesAcross").addEventListener("change", (e) => {
    const value = clamp(
      Math.round(Number(e.target.value) || DEFAULTS.hexesAcross),
      HEXES_ACROSS_MIN,
      HEXES_ACROSS_MAX,
    );
    e.target.value = value;
    update({ hexesAcross: value });
  });

  el("strokeColor").addEventListener("input", (e) => update({ strokeColor: e.target.value }));

  el("strokeWidth").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    el("strokeWidthVal").textContent = value;
    update({ strokeWidth: value });
  });

  for (const axis of ["offsetX", "offsetY"]) {
    el(axis).addEventListener("input", (e) => {
      const value = Number(e.target.value);
      el(`${axis}Val`).textContent = value.toFixed(2);
      update({ [axis]: value });
    });
  }

  el("resetNudge").addEventListener("click", () => update({ offsetX: 0, offsetY: 0 }));
}

function applyTheme(theme) {
  const root = document.documentElement.style;
  root.setProperty("--text", theme.text.primary);
  root.setProperty("--text-dim", theme.text.secondary);
  root.setProperty("--accent", theme.primary.main);
  const dark = theme.mode === "DARK";
  root.setProperty("--border", dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.16)");
  root.setProperty("--warn-text", dark ? "#ffcc66" : "#8a5a00");
  // Owlbear's theme may not match the browser's, so pin the form-control
  // rendering to the theme Owlbear reports.
  root.setProperty("color-scheme", dark ? "dark" : "light");
}

/* ---------------------------------------------------------------- lifecycle */

async function refreshGrid() {
  const [nextDpi, nextType, nextLineWidth] = await Promise.all([
    OBR.scene.grid.getDpi(),
    OBR.scene.grid.getType(),
    OBR.scene.grid.getLineWidth(),
  ]);
  dpi = nextDpi;
  gridType = nextType;
  gridLineWidth = nextLineWidth;
}

async function loadScene() {
  await refreshGrid();
  const metadata = await OBR.scene.getMetadata();
  const hadSettings = Boolean(metadata?.[SETTINGS_KEY]);
  settings = readSettings(metadata);

  // First run in this scene: start the overlay a good bit heavier than the
  // scene's own grid lines so it reads as the dominant grid.
  if (!hadSettings) {
    settings.strokeWidth = clamp(Math.round((gridLineWidth || 2) * 3), 1, 30);
  }

  syncInputs();
  syncStatus();
  // Redraw on open, so an overlay left stale by a grid change made while the
  // popover was shut corrects itself as soon as the GM looks at it.
  scheduleRedraw();
}

async function init() {
  role = await OBR.player.getRole();
  bindInputs();

  try {
    applyTheme(await OBR.theme.getTheme());
  } catch (err) {
    console.warn("[travel-day-hex] could not read theme", err);
  }
  OBR.theme.onChange(applyTheme);

  OBR.player.onChange((player) => {
    if (player.role !== role) {
      role = player.role;
      syncStatus();
    }
  });

  OBR.scene.grid.onChange((grid) => {
    // The GM changed DPI or grid type under us; rescale to match.
    dpi = grid.dpi;
    gridType = grid.type;
    gridLineWidth = grid.style?.lineWidth ?? gridLineWidth;
    syncStatus();
    scheduleRedraw();
  });

  OBR.scene.onMetadataChange((metadata) => {
    settings = readSettings(metadata);
    syncInputs();
    syncStatus();
    scheduleRedraw();
  });

  OBR.scene.onReadyChange(async (ready) => {
    sceneReady = ready;
    if (ready) await loadScene();
    else syncStatus();
  });

  sceneReady = await OBR.scene.isReady();
  if (sceneReady) await loadScene();
  else syncStatus();
}

if (OBR.isAvailable) {
  OBR.onReady(() => {
    init().catch((err) => console.error("[travel-day-hex] init failed", err));
  });
} else {
  el("status").className = "warn";
  el("status").textContent =
    "This page is an Owlbear Rodeo extension. Install it in Owlbear rather than opening it directly.";
  document.body.classList.add("readonly");
}
