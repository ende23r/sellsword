import { Resvg } from '@resvg/resvg-js';
import type { ArmyRow, HexRow, StrongholdRow } from './db.js';
import { hexCorners, hexToPixel } from './hex.js';

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

const STRONGHOLD_SYMBOL: Record<string, string> = {
  city: '⬛',
  town: '▪',
  fortress: '⬢',
};

type RenderOptions = {
  visibleCoords?: Set<string>; // 'q,r' strings; undefined = show all (admin view)
  armyPositions?: ArmyRow[];
  hexSize?: number; // override default size
};

export async function renderMap(
  hexes: HexRow[],
  strongholds: StrongholdRow[],
  options: RenderOptions = {},
): Promise<Buffer> {
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
  const roadLines: string[] = [];
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
    const roads: string[] = JSON.parse(hex.roads);
    for (const dir of roads) {
      const neighbor = neighborCoordForDirection(hex.q, hex.r, dir);
      const neighborHex = hexes.find((h) => h.q === neighbor.q && h.r === neighbor.r);
      if (neighborHex) {
        const [nx, ny] = hexToPixel(neighborHex, size, -minX, -minY);
        // Draw only half the line (to the midpoint) to avoid double-drawing
        const mx = (cx + nx) / 2;
        const my = (cy + ny) / 2;
        roadLines.push(
          `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#8b6914" stroke-width="2" stroke-linecap="round"/>`,
        );
      }
    }

    // Rivers: draw along the hex edge toward each indicated direction
    const rivers: string[] = JSON.parse(hex.rivers);
    for (const dir of rivers) {
      const neighbor = neighborCoordForDirection(hex.q, hex.r, dir);
      const neighborHex = hexes.find((h) => h.q === neighbor.q && h.r === neighbor.r);
      if (neighborHex) {
        const [nx, ny] = hexToPixel(neighborHex, size, -minX, -minY);
        const mx = (cx + nx) / 2;
        const my = (cy + ny) / 2;
        riverLines.push(
          `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#3a7abf" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>`,
        );
      }
    }

    // Settlement score label
    if (hex.settlement > 0) {
      labels.push(
        `<text x="${cx.toFixed(1)}" y="${(cy + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="8" fill="#333" font-family="sans-serif">${hex.settlement}</text>`,
      );
    }

    // Coordinates (small, top of hex)
    labels.push(
      `<text x="${cx.toFixed(1)}" y="${(cy - size * 0.55).toFixed(1)}" text-anchor="middle" font-size="7" fill="#666" font-family="monospace">${hex.q},${hex.r}</text>`,
    );

    // Stronghold
    const stronghold = strongholdByHexId.get(hex.id);
    if (stronghold) {
      const symbol = STRONGHOLD_SYMBOL[stronghold.type] ?? '?';
      labels.push(
        `<text x="${cx.toFixed(1)}" y="${(cy - size * 0.15).toFixed(1)}" text-anchor="middle" font-size="10" fill="#111" font-family="sans-serif">${symbol}</text>`,
        `<text x="${cx.toFixed(1)}" y="${(cy + size * 0.65).toFixed(1)}" text-anchor="middle" font-size="7" fill="#111" font-weight="bold" font-family="sans-serif">${stronghold.name}</text>`,
      );
    }
  }

  // Army markers
  if (options.armyPositions) {
    for (const army of options.armyPositions) {
      const coordKey = `${army.hex_q},${army.hex_r}`;
      if (options.visibleCoords && !options.visibleCoords.has(coordKey)) continue;
      const [cx, cy] = hexToPixel({ q: army.hex_q, r: army.hex_r }, size, -minX, -minY);
      labels.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#e63" stroke="#fff" stroke-width="1"/>`,
      );
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1a1a2e"/>
  ${hexPolygons.join('\n  ')}
  ${roadLines.join('\n  ')}
  ${riverLines.join('\n  ')}
  ${labels.join('\n  ')}
</svg>`;

  const resvg = new Resvg(svg, { fitTo: { mode: 'original' } });
  return Buffer.from(resvg.render().asPng());
}

function neighborCoordForDirection(q: number, r: number, dir: string): { q: number; r: number } {
  const dirs: Record<string, { q: number; r: number }> = {
    N: { q: 0, r: -1 },
    NE: { q: 1, r: -1 },
    SE: { q: 1, r: 0 },
    S: { q: 0, r: 1 },
    SW: { q: -1, r: 1 },
    NW: { q: -1, r: 0 },
  };
  const d = dirs[dir] ?? { q: 0, r: 0 };
  return { q: q + d.q, r: r + d.r };
}
