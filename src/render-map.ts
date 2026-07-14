import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { getAllArmies, getAllHexes, getAllStrongholds } from './lib/db.js';
import { renderMap } from './lib/map-render.js';

const args = process.argv.slice(2);
const outPath = resolve(args[0] ?? 'map.png');

const hexes = getAllHexes();
if (hexes.length === 0) {
  console.error('No map data found. Run npm run seed first.');
  process.exit(1);
}

const png = await renderMap(hexes, getAllStrongholds(), {
  armyPositions: getAllArmies(),
  hexSize: 128,
});

writeFileSync(outPath, png);
console.log(`Map saved to ${outPath} (${hexes.length} hexes, ${png.length} bytes)`);
