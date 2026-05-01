// Centralized localStorage keys. Keep all bare-string keys here so renaming
// or namespacing is a one-touch change.
export const STORAGE_KEYS = {
  rules: 'tradl.rules.v1',
  columns: 'tradl.columns.v1',
  paletteRecent: 'tradl.palette.recent',
  theme: 'tradl.theme',
  expanded: 'tradl.expanded',
} as const;
