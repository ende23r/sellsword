import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import db from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const clearOnly = args.includes('--clear') && args.length === 1;
const pathArg = args.find((a) => !a.startsWith('--'));
const seedPath = pathArg ? resolve(pathArg) : join(__dirname, '../map-seed.json');

// ── Clear ──────────────────────────────────────────────────────────────────

if (args.includes('--clear')) {
  db.exec('DELETE FROM strongholds; DELETE FROM hexes;');
  console.log('Map data cleared.');
  if (clearOnly) process.exit(0);
}

// ── Seed ───────────────────────────────────────────────────────────────────

type StrongholdSeed = {
  name: string;
  type: 'fortress' | 'town' | 'city';
  garrison: number;
  threshold: number;
  controlled_by: string | null;
};

type HexSeed = {
  q: number;
  r: number;
  terrain: string;
  settlement: number;
  roads: string[];
  rivers: string[];
  speed?: number;
  stronghold?: StrongholdSeed;
};

type SeedFile = {
  meta: { name: string; hex_size_miles: number };
  hexes: HexSeed[];
};

let raw: string;
try {
  raw = readFileSync(seedPath, 'utf-8');
} catch {
  console.error(
    `Seed file not found: ${seedPath}\nCopy map-seed.example.json and fill in your map data.`,
  );
  process.exit(1);
}

const seed: SeedFile = JSON.parse(raw);

const IMPASSABLE_TERRAIN = new Set(['sea', 'coast']);

const insertHex = db.prepare(`
  INSERT INTO hexes (q, r, terrain, settlement, roads, rivers, speed)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(q, r) DO UPDATE SET
    terrain = excluded.terrain,
    settlement = excluded.settlement,
    roads = excluded.roads,
    rivers = excluded.rivers,
    speed = excluded.speed
`);

const insertStronghold = db.prepare(`
  INSERT INTO strongholds (hex_id, name, type, garrison, threshold, controlled_by)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT DO NOTHING
`);

const runSeed = db.transaction(() => {
  let hexCount = 0;
  let strongholdCount = 0;

  for (const hex of seed.hexes) {
    const hexSpeed = hex.speed ?? (IMPASSABLE_TERRAIN.has(hex.terrain) ? 0 : 6);
    insertHex.run(
      hex.q,
      hex.r,
      hex.terrain,
      hex.settlement,
      JSON.stringify(hex.roads ?? []),
      JSON.stringify(hex.rivers ?? []),
      hexSpeed,
    );

    if (hex.stronghold) {
      const row = db.prepare('SELECT id FROM hexes WHERE q = ? AND r = ?').get(hex.q, hex.r) as {
        id: number;
      };
      insertStronghold.run(
        row.id,
        hex.stronghold.name,
        hex.stronghold.type,
        hex.stronghold.garrison,
        hex.stronghold.threshold,
        hex.stronghold.controlled_by,
      );
      strongholdCount++;
    }

    hexCount++;
  }

  return { hexCount, strongholdCount };
});

const { hexCount, strongholdCount } = runSeed();
console.log(`Seeded ${hexCount} hexes and ${strongholdCount} strongholds from "${seed.meta.name}".`);
