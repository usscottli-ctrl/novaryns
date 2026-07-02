/** 比例方块数据(spec B.4)。w/h 仅用于迷你形状预览(最长边约 26px),value 接 API。 */
export type RatioTileData = { id: string; label: string; w: number; h: number };

export const ratioTiles: RatioTileData[] = [
  { id: "1:1", label: "1:1", w: 22, h: 22 },
  { id: "4:3", label: "4:3", w: 26, h: 20 },
  { id: "3:2", label: "3:2", w: 27, h: 18 },
  { id: "16:9", label: "16:9", w: 28, h: 16 },
  { id: "4:5", label: "4:5", w: 18, h: 22 },
  { id: "3:4", label: "3:4", w: 17, h: 22 },
  { id: "2:3", label: "2:3", w: 15, h: 22 },
  { id: "9:16", label: "9:16", w: 13, h: 22 },
];

/** 画布比例浮层(spec B.4 ratioTilesC = 11,含「自适应」虚线)。 */
export const ratioTilesC: RatioTileData[] = [
  { id: "auto", label: "自适应", w: 24, h: 18 },
  ...ratioTiles,
  { id: "2:1", label: "2:1", w: 28, h: 14 },
  { id: "1:2", label: "1:2", w: 12, h: 24 },
];
