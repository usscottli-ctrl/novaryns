// Stand-in imagery, now self-hosted on our own R2 (mirrored from the original
// Unsplash sources via scripts/images-to-r2). Keeping everything on our domain
// avoids third-party hotlinking. <Media> still falls back to a gradient if a
// URL ever fails to load.

const base = "https://pub-d4d9c8471e8d4d94b159b20f7fbdb7d7.r2.dev/assets";

// `w` is kept for call-site compatibility; R2 serves a single pre-sized asset.
export function img(id: string, w = 900): string {
  void w;
  return `${base}/${id}.jpg`;
}

export const IMAGES = {
  skincare: [
    "1556228720-195a672e8a03",
    "1612817288484-6f916006741a",
    "1598440947619-2c35fc9aa908",
    "1620916566398-39f1143ab7be",
    "1571781926291-c477ebfd024b",
  ],
  fashion: [
    "1490481651871-ab68de25d43d",
    "1483985988355-763728e1935b",
    "1485462537746-965f33f7f6a7",
    "1487058792275-0ad4aaf24ca7",
    "1542838132-92c53300491e",
  ],
  food: [
    "1504674900247-0877df9cc836",
    "1467003909585-2f8a72700288",
    "1490645935967-10de6ba17061",
    "1503342217505-b0a15ec3261c",
    "1576426863848-c21f53c60b19",
  ],
  home: [
    "1586023492125-27b2c045efd7",
    "1556909114-f6e7ad7d3136",
    "1493663284031-b7e3aefcae8e",
    "1583394838336-acd977736f90",
    "1631214540553-ff044a3ff1d4",
  ],
  digital: [
    "1505740420928-5e560c06d30e",
    "1517336714731-489689fd1ca8",
    "1526738549149-8e07eca6c147",
    "1591047139829-d91aecb6caea",
    "1545454675-3531b543be5d",
  ],
  ecommerce: [
    "1607082348824-0a96f2a4b9da",
    "1556742049-0cfed4f6a45d",
    "1522335789203-aabd1fc54bc9",
    "1542291026-7eec264c27ff",
    "1560769629-975ec94e6a86",
    "1531297484001-80022131f5a1",
  ],
} as const;

// Pool used by the mock generate API, keyed by output category.
export const CATEGORY_IMAGES: Record<string, string[]> = {
  main: [
    IMAGES.skincare[0],
    IMAGES.digital[0],
    IMAGES.ecommerce[3],
    IMAGES.skincare[1],
  ],
  banner: [
    IMAGES.ecommerce[2],
    IMAGES.fashion[1],
    IMAGES.ecommerce[0],
    IMAGES.ecommerce[5],
  ],
  scene: [
    IMAGES.home[0],
    IMAGES.food[1],
    IMAGES.skincare[2],
    IMAGES.fashion[3],
  ],
  xiaohongshu: [
    IMAGES.skincare[3],
    IMAGES.digital[2],
    IMAGES.food[3],
    IMAGES.skincare[4],
  ],
  detail: [
    IMAGES.home[1],
    IMAGES.fashion[4],
    IMAGES.home[3],
    IMAGES.digital[4],
  ],
};
