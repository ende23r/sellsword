import 'dotenv/config';
import {
  extractSheetId,
  fetchArmyStats,
  fetchDefinedRangeNames,
  isCavalryOnly,
  missingStatRanges,
  statWriteData,
  supplyUpkeep,
  totalGoods,
  totalStrength,
  totalWagons,
} from './lib/sheets.js';

// Validates a GM's army sheet and prints what the bot reads from it.
// Usage: npm run check-sheet -- <sheet URL or ID>

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run check-sheet -- <sheet URL or ID>');
  process.exit(1);
}
const sheetId = arg.includes('/d/') ? extractSheetId(arg) : arg;
if (!sheetId) {
  console.error(`Could not extract a sheet ID from "${arg}".`);
  process.exit(1);
}

console.log(`Checking army sheet ${sheetId} …\n`);

const defined = await fetchDefinedRangeNames(sheetId);
const missing = missingStatRanges(defined);
if (missing.length > 0) {
  console.error(`✗ Missing named ranges (${missing.length}): ${missing.join(', ')}`);
  console.error('  Define them in the sheet via Data → Named ranges, then re-run.');
  if (defined.length > 0) console.error(`  Named ranges found: ${defined.join(', ')}`);
  process.exit(1);
}
console.log('✅ All stat named ranges are defined.\n');

let stats;
try {
  stats = await fetchArmyStats(sheetId);
} catch (err) {
  console.error(`✗ Reading stats failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log('Stats as the bot reads them:');
for (const [key, value] of Object.entries(stats)) {
  if (key === 'infantry_detachments' || key === 'cavalry_detachments' || key === 'goods') continue;
  console.log(`  ${key.padEnd(18)} ${value}`);
}

for (const [label, detachments] of [
  ['Infantry detachments', stats.infantry_detachments],
  ['Cavalry detachments', stats.cavalry_detachments],
] as const) {
  console.log(`\n${label} (${detachments.length}):`);
  for (const d of detachments) {
    console.log(
      `  ${(d.name || '(unnamed)').padEnd(24)} size ${String(d.size).padEnd(6)} ×${String(d.multiplier).padEnd(4)} strength ${String(d.strength).padEnd(6)} wagons ${String(d.wagons).padEnd(4)} ${d.notes}`,
    );
  }
}
console.log(`\nGoods (${stats.goods.length}):`);
for (const g of stats.goods) {
  console.log(`  ${(g.name || '(unnamed)').padEnd(24)} ${g.count}`);
}

console.log('Derived totals:');
console.log(`  supply upkeep/day  ${supplyUpkeep(stats) + stats.noncombatants + totalWagons(stats) * 10}`);
console.log(`  strength           ${totalStrength(stats)}`);
console.log(`  wagons             ${totalWagons(stats)}`);
console.log(`  cavalry-only       ${isCavalryOnly(stats)}`);
console.log(`  goods              ${totalGoods(stats)}`);

console.log('\nValues the bot would write back on the next sync:');
for (const { range, values } of statWriteData(stats)) {
  console.log(`  ${range.padEnd(18)} ${values[0][0]}`);
}

console.log('\n✅ Sheet is ready.');
