import Database from 'better-sqlite3';
import { Resvg } from '@resvg/resvg-js';
import type { HexRow, StrongholdRow } from './db.js';
import { hexCorners, hexesInRange, hexToPixel } from './hex.js';
import type { HexCoord } from './hex.js';

export type ArmyMarker = {
  hex_q: number;
  hex_r: number;
  name: string | null;
  faction_color: string | null;
};

export function getArmiesForMap(
  db: Database.Database,
  statsMap: Map<number, { hex_q: number; hex_r: number }>,
): ArmyMarker[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, f.color AS faction_color
       FROM armies a
       JOIN commanders c ON c.id = a.commander_id
       LEFT JOIN factions f ON f.id = c.faction_id`,
    )
    .all() as { id: number; name: string | null; faction_color: string | null }[];

  return rows
    .filter((row) => statsMap.has(row.id))
    .map((row) => {
      const s = statsMap.get(row.id)!;
      return { hex_q: s.hex_q, hex_r: s.hex_r, name: row.name, faction_color: row.faction_color };
    });
}

export function armyInitials(name: string | null): string {
  if (!name?.trim()) return '?';
  const tokens = name.trim().split(/\s+/);
  const parts = tokens.map((t) => {
    const digits = t.match(/^(\d+)/);
    return digits ? digits[1] : t[0].toUpperCase();
  });
  return parts.join('').slice(0, 3);
}

const HEX_SIZE = 64; // circumradius in pixels (default; override via renderMap options)

const TERRAIN_COLOR: Record<string, string> = {
  flatland: '#d4c49a',
  hills: '#b8936a',
  forest: '#5a8a4a',
  mountains: '#8a8080',
  marsh: '#6a9e7a',
  coast: '#9ec4d4',
  sea: '#5a7eb4',
};

// Corner index pairs for each edge direction (pointy-top hex, corners 0–5 at -30°,30°,90°,150°,210°,270°)
const RIVER_EDGE_CORNERS: Record<string, [number, number]> = {
  NW: [4, 5],
  NE: [5, 0],
  E:  [0, 1],
  SE: [1, 2],
  SW: [2, 3],
  W:  [3, 4],
};

const STRONGHOLD_SYMBOL: Record<string, string> = {
  city: '⬛',
  town: '▪',
};

export function getPlayerMapHexes(
  allHexes: HexRow[],
  center: HexCoord,
  scoutRange: number,
): { hexes: HexRow[]; visibleCoords: Set<string> } {
  const visibleCoords = new Set(hexesInRange(center, scoutRange).map((h) => `${h.q},${h.r}`));
  const fogCoords = new Set(hexesInRange(center, scoutRange + 1).map((h) => `${h.q},${h.r}`));
  const hexes = allHexes.filter((h) => fogCoords.has(`${h.q},${h.r}`));
  return { hexes, visibleCoords };
}

type RenderOptions = {
  visibleCoords?: Set<string>; // 'q,r' strings; undefined = show all (admin view)
  armyPositions?: ArmyMarker[];
  hexSize?: number; // override default size
  showSettlementScores?: boolean; // default true; player maps pass false
};

export function buildMapSvg(
  hexes: HexRow[],
  strongholds: StrongholdRow[],
  options: RenderOptions = {},
): string {
  if (hexes.length === 0) throw new Error('No hex data to render.');

  const size = options.hexSize ?? HEX_SIZE;
  const padding = size * 2;

  const strongholdByHexId = new Map<number, StrongholdRow>(strongholds.map((s) => [s.hex_id, s]));

  // Calculate bounding box
  const pixelCoords = hexes.map((h) => hexToPixel(h, size));
  const minX = Math.min(...pixelCoords.map(([x]) => x)) - padding;
  const minY = Math.min(...pixelCoords.map(([, y]) => y)) - padding;
  const maxX = Math.max(...pixelCoords.map(([x]) => x)) + padding;
  const maxY = Math.max(...pixelCoords.map(([, y]) => y)) + padding;
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);

  const hexPolygons: string[] = [];
  const roadBorders: string[] = [];
  const roadLines: string[] = [];
  const riverBorders: string[] = [];
  const riverLines: string[] = [];
  const labels: string[] = [];

  for (const hex of hexes) {
    const coordKey = `${hex.q},${hex.r}`;
    const visible = !options.visibleCoords || options.visibleCoords.has(coordKey);
    const [cx, cy] = hexToPixel(hex, size, -minX, -minY);
    const corners = hexCorners(cx, cy, size);
    const points = corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    const fill = visible ? (TERRAIN_COLOR[hex.terrain] ?? '#cccccc') : '#222222';
    hexPolygons.push(
      `<polygon points="${points}" fill="${fill}" stroke="#444" stroke-width="0.8"/>`,
    );

    if (!visible) continue;

    // Roads: draw from center toward each neighbor that also has a road on the connecting edge
    const roads = parseDirections(hex.roads);
    for (const dir of roads) {
      const neighbor = neighborCoordForDirection(hex.q, hex.r, dir);
      const neighborHex = hexes.find((h) => h.q === neighbor.q && h.r === neighbor.r);
      if (neighborHex) {
        const [nx, ny] = hexToPixel(neighborHex, size, -minX, -minY);
        // Draw only half the line (to the midpoint) to avoid double-drawing
        const mx = (cx + nx) / 2;
        const my = (cy + ny) / 2;
        roadBorders.push(
          `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#000" stroke-width="4" stroke-linecap="round"/>`,
        );
        roadLines.push(
          `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#8b6914" stroke-width="2" stroke-linecap="round"/>`,
        );
      }
    }

    // Rivers: draw along the shared hex edge (between two corner points)
    const rivers = parseDirections(hex.rivers);
    for (const dir of rivers) {
      const edgeCorners = RIVER_EDGE_CORNERS[dir];
      if (!edgeCorners) continue;
      const [a, b] = [corners[edgeCorners[0]], corners[edgeCorners[1]]];
      riverBorders.push(
        `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#000" stroke-width="5" stroke-linecap="round"/>`,
      );
      riverLines.push(
        `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#3a7abf" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>`,
      );
    }

    // Settlement score label (full map only — hidden from player views)
    if (hex.settlement > 0 && (options.showSettlementScores ?? true)) {
      labels.push(
        `<text x="${cx.toFixed(1)}" y="${(cy + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="18" fill="#333" font-family="sans-serif">${hex.settlement}</text>`,
      );
    }

    // Coordinates (small, top of hex)
    labels.push(
      `<text x="${cx.toFixed(1)}" y="${(cy - size * 0.55).toFixed(1)}" text-anchor="middle" font-size="17" fill="#666" font-family="monospace">${hex.q},${hex.r}</text>`,
    );

    // Stronghold
    const stronghold = strongholdByHexId.get(hex.id);
    if (stronghold) {
      const nameLine = `<text x="${cx.toFixed(1)}" y="${(cy + size * 0.65).toFixed(1)}" text-anchor="middle" font-size="17" fill="#111" font-weight="bold" font-family="sans-serif" stroke="white" stroke-width="3" paint-order="stroke">${stronghold.name}</text>`;
      if (stronghold.type === 'city') {
        const r = size * 0.28;
        const pcy = cy - size * 0.1;
        labels.push(
          `<polygon points="${pentagonPoints(cx, pcy, r)}" fill="#1a1a1a" stroke="#fff" stroke-width="1.5"/>`,
          nameLine,
        );
      } else if (stronghold.type === 'town') {
        // side = 3/4 of pentagon's side length (pentagon side = R * 2 * sin(π/5))
        const half = size * 0.28 * Math.sin(Math.PI / 5) * 0.75;
        const r = half;
        const pcy = cy - size * 0.1;
        labels.push(
          `<rect x="${(cx - r).toFixed(1)}" y="${(pcy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="#1a1a1a" stroke="#fff" stroke-width="1.5"/>`,
          nameLine,
        );
      } else if (stronghold.type === 'fortress') {
        const r = size * 0.187;
        const pcy = cy - size * 0.1;
        labels.push(
          `<polygon points="${trianglePoints(cx, pcy, r)}" fill="#1a1a1a" stroke="#fff" stroke-width="1.5"/>`,
          nameLine,
        );
      } else {
        const symbol = STRONGHOLD_SYMBOL[stronghold.type] ?? '?';
        labels.push(
          `<text x="${cx.toFixed(1)}" y="${(cy - size * 0.15).toFixed(1)}" text-anchor="middle" font-size="23" fill="#111" font-family="sans-serif">${symbol}</text>`,
          nameLine,
        );
      }
    }
  }

  // Army markers — group by hex so multiple armies offset into a ring
  if (options.armyPositions) {
    const armiesByHex = new Map<string, ArmyMarker[]>();
    for (const army of options.armyPositions) {
      const key = `${army.hex_q},${army.hex_r}`;
      if (!armiesByHex.has(key)) armiesByHex.set(key, []);
      armiesByHex.get(key)!.push(army);
    }

    for (const [coordKey, armiesInHex] of armiesByHex) {
      if (options.visibleCoords && !options.visibleCoords.has(coordKey)) continue;
      const [hex_q, hex_r] = coordKey.split(',').map(Number);
      const [cx, cy] = hexToPixel({ q: hex_q, r: hex_r }, size, -minX, -minY);
      const offsets = armyRingOffsets(armiesInHex.length, size * 0.3);
      const markerR = 15;

      armiesInHex.forEach((army, i) => {
        const ax = cx + offsets[i][0];
        const ay = cy + offsets[i][1];
        const fill = army.faction_color ?? '#e63';
        const initials = armyInitials(army.name);
        labels.push(
          `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${markerR}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`,
          `<text x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="bold" fill="#fff" font-family="monospace">${initials}</text>`,
        );
      });
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1a1a2e"/>
  ${hexPolygons.join('\n  ')}
  ${roadBorders.join('\n  ')}
  ${roadLines.join('\n  ')}
  ${riverBorders.join('\n  ')}
  ${riverLines.join('\n  ')}
  ${labels.join('\n  ')}
</svg>`;
}

export async function renderMap(
  hexes: HexRow[],
  strongholds: StrongholdRow[],
  options: RenderOptions = {},
): Promise<Buffer> {
  const svg = buildMapSvg(hexes, strongholds, options);
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' } });
  return Buffer.from(resvg.render().asPng());
}

// Returns [dx, dy] offsets for N army markers. Single army stays at center; multiple spread on a ring.
export function armyRingOffsets(count: number, ringRadius: number): Array<[number, number]> {
  if (count === 1) return [[0, 0]];
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI / 180) * (-90 + i * (360 / count));
    return [ringRadius * Math.cos(angle), ringRadius * Math.sin(angle)];
  });
}

// North-pointing pentagon: first vertex at -90° (top), then every 72°
// Roads/rivers come from seed JSON — a bad blob should degrade to "none", not kill the render
function parseDirections(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function pentagonPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 5 }, (_, i) => {
    const angle = (Math.PI / 180) * (-90 + i * 72);
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(' ');
}

// North-pointing equilateral triangle: first vertex at -90° (top), then every 120°
export function trianglePoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 3 }, (_, i) => {
    const angle = (Math.PI / 180) * (-90 + i * 120);
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(' ');
}

function neighborCoordForDirection(q: number, r: number, dir: string): { q: number; r: number } {
  const dirs: Record<string, { q: number; r: number }> = {
    NW: { q: 0, r: -1 },
    NE: { q: 1, r: -1 },
    E:  { q: 1, r: 0 },
    SE: { q: 0, r: 1 },
    SW: { q: -1, r: 1 },
    W:  { q: -1, r: 0 },
  };
  const d = dirs[dir] ?? { q: 0, r: 0 };
  return { q: q + d.q, r: r + d.r };
}
