// Hue-based palette: each rule's identity is one HSL hue (0–360). The renderer
// derives backgrounds, swatches, and text colors via the helpers below so the
// "categorical" feel from the design comes through without per-color picking.

export interface NamedHue { hue: number; name: string }

// Curated hues — same set the design exposes in its color picker (10 distinct).
export const PALETTE_HUES: NamedHue[] = [
  { hue: 210, name: 'Sky' },
  { hue: 280, name: 'Violet' },
  { hue: 38,  name: 'Amber' },
  { hue: 142, name: 'Emerald' },
  { hue: 0,   name: 'Crimson' },
  { hue: 168, name: 'Teal' },
  { hue: 12,  name: 'Coral' },
  { hue: 95,  name: 'Lime' },
  { hue: 320, name: 'Magenta' },
  { hue: 50,  name: 'Yellow' },
  { hue: 195, name: 'Cyan' },
  { hue: 240, name: 'Indigo' },
];

// HSL helpers — drive every rule-related visual.

export function ruleHsl(hue: number, intensity = 0.55): string {
  return `hsla(${hue}, 75%, 55%, ${intensity})`;
}

export function ruleBg(hue: number, alpha = 0.14): string {
  return `hsla(${hue}, 70%, 50%, ${alpha})`;
}

export function ruleFg(hue: number): string {
  return `hsl(${hue}, 90%, 72%)`;
}

// Pick the next palette hue not already in `usedHues` — used when creating new rules.
export function nextUnusedHue(usedHues: number[]): number {
  const used = new Set(usedHues);
  const free = PALETTE_HUES.find((p) => !used.has(p.hue));
  return free ? free.hue : PALETTE_HUES[usedHues.length % PALETTE_HUES.length].hue;
}

// Find the palette hue closest to a given hex color — used for hex→hue migration.
export function hueFromHex(hex: string): number {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return PALETTE_HUES[0].hue;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return PALETTE_HUES[0].hue;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  // Snap to nearest palette hue
  let best = PALETTE_HUES[0].hue;
  let bestDist = Infinity;
  for (const p of PALETTE_HUES) {
    const d2 = Math.min(Math.abs(p.hue - h), 360 - Math.abs(p.hue - h));
    if (d2 < bestDist) { best = p.hue; bestDist = d2; }
  }
  return best;
}
