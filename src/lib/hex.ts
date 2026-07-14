// Axial coordinate system for a pointy-top hex grid.
// Reference: https://www.redblobgames.com/grids/hexagons/

export type HexCoord = { q: number; r: number };

// The six neighbor directions in axial coordinates.
// +q=E, -q=W, +r=SE, -r=NW; diagonals are NE and SW.
export const HEX_DIRECTIONS: Record<string, HexCoord> = {
  NW: { q: 0, r: -1 },
  NE: { q: 1, r: -1 },
  E:  { q: 1, r: 0 },
  SE: { q: 0, r: 1 },
  SW: { q: -1, r: 1 },
  W:  { q: -1, r: 0 },
};

export const OPPOSITE_DIRECTION: Record<string, string> = {
  NW: 'SE',
  NE: 'SW',
  E:  'W',
  SE: 'NW',
  SW: 'NE',
  W:  'E',
};

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hexNeighbors(h: HexCoord): HexCoord[] {
  return Object.values(HEX_DIRECTIONS).map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function hexesInRange(center: HexCoord, radius: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }
  return results;
}

// Pixel center of a hex in a pointy-top layout, given hex size (circumradius) and padding offset.
export function hexToPixel(h: HexCoord, size: number, offsetX = 0, offsetY = 0): [number, number] {
  const x = size * Math.sqrt(3) * (h.q + h.r / 2) + offsetX;
  const y = size * 1.5 * h.r + offsetY;
  return [x, y];
}

// The 6 corner points of a pointy-top hex centered at (cx, cy).
export function hexCorners(cx: number, cy: number, size: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return [cx + size * Math.cos(angle), cy + size * Math.sin(angle)] as [number, number];
  });
}

// BFS shortest path between two hexes. Returns ordered steps excluding `from`, including `to`.
// Returns empty array if no path exists or if from === to.
export function findPath(from: HexCoord, to: HexCoord, validCoords: Set<string>): HexCoord[] {
  const key = (h: HexCoord) => `${h.q},${h.r}`;
  if (from.q === to.q && from.r === to.r) return [];

  const queue: HexCoord[] = [from];
  const prev = new Map<string, string | null>();
  prev.set(key(from), null);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.q === to.q && cur.r === to.r) break;
    for (const d of Object.values(HEX_DIRECTIONS)) {
      const next = { q: cur.q + d.q, r: cur.r + d.r };
      const nk = key(next);
      if (!validCoords.has(nk) || prev.has(nk)) continue;
      prev.set(nk, key(cur));
      queue.push(next);
    }
  }

  if (!prev.has(key(to))) return [];

  const path: HexCoord[] = [];
  let cur: string | null | undefined = key(to);
  const fromKey = key(from);
  while (cur && cur !== fromKey) {
    const [q, r] = cur.split(',').map(Number);
    path.unshift({ q, r });
    cur = prev.get(cur);
  }
  return path;
}

// Miles traveled per day given terrain, road usage, and march pace.
export function milesPerDay(onRoad: boolean, forcedMarch: boolean, nightMarch: boolean): number {
  const base = onRoad ? 12 : 6;
  const march = forcedMarch ? base * 1.5 : base;
  return nightMarch ? march + (onRoad ? 6 : 0) : march;
}

// Days to deliver a message over a given hex distance (assumes friendly territory).
export const MESSAGE_SPEED_MILES_PER_DAY = 48;
export function messageDeliveryDays(hexDist: number): number {
  return Math.ceil((hexDist * 6) / MESSAGE_SPEED_MILES_PER_DAY);
}
