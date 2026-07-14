# TODOs

Places where the code diverges from the architecture or the rules.

---

## Rule compliance gaps

**Forage revolt risk is warned about but never rolled** (`src/commands/forage.ts`, `src/lib/tick-processors.ts:processForage`)
The forage command warns the admin when revolt risk is elevated (any hex with `forage_count >= 1`), but the actual 2d6 roll and revolt army creation are never performed. The forage processor should roll for revolt and apply the result.

**No coin consumption for mercenary wages** (`src/lib/tick-processors.ts:consumeSupplies`)
The rules specify monthly wages (1 coin/infantry/month, 10 coin/cavalry/month, 100 coin/ship/month), and unpaid mercenaries lose 3 morale and check morale. Nothing deducts coin at any tick.

**Supply carry capacity not enforced** (`src/lib/db.ts`, `src/lib/tick-processors.ts`)
The rules specify maximum carry capacity (15 supplies/infantry+noncombatant, 75/cavalry, 1000/wagon). No command or tick enforces this cap.

**River crossings not implemented** (`src/lib/tick-processors.ts:advanceArmy`)
Fording a river costs half a day per mile of infantry column. Movement crosses river edges without any cost or check.

**Long column penalty not implemented** (`src/lib/tick-processors.ts:advanceArmy`)
Armies stretching over 6 miles of road travel at half speed. Column length = (infantry + noncombatants) / 5000 + cavalry / 2000 + wagons / 50 miles. No penalty applied.

**Night march: wrong path at forks not implemented** (`src/lib/tick-processors.ts:processNightMarchMovement`)
2-in-6 chance of taking the wrong path at a fork during a night march. No fork detection exists.

**Skirmishers not counted for extended forage/scouting range** (`src/lib/tick-processors.ts:processForage`, `src/commands/map.ts`)
Both forage range and scouting range check `army.cavalry > 0` but ignore skirmisher detachments (`type = 'skirmisher'` in the `detachments` table).

**Road connectivity not verified during movement** (`src/lib/tick-processors.ts:advanceArmy`)
`findPath` does BFS through all valid hex coordinates without checking road edges. When `roads_only = true`, the path is not constrained to road-connected hexes.

**`/map` shows all army positions regardless of fog of war** (`src/commands/map.ts:49`)
`armyPositions: armies` passes every army to the renderer. Players should only see armies within their scouting range.

---

## Missing commands

**No `/rest` command**
The rules have a detailed rest mechanic (weekly morale recovery, morale payment in towns/cities, noncombatant reset). The `orders` table supports `type = 'rest'` but no command creates rest orders and no tick processes them.

**No `/torch` command**
The rules allow armies to spend a day torching hexes (removes forage until spring, revolt risk). The `orders` table supports `type = 'torch'` but no command or tick handles it.

---

## Data model gaps

**`commission` does not set `faction_id` on the commander** (`src/commands/commission.ts`)
The `commanders.faction_id` foreign key exists in the schema but is never written. The commander's faction is only implied by their Discord role.

**`factions` table is never populated** (`src/commands/recruit.ts`, `src/commands/commission.ts`)
Both `/recruit` and `/commission` operate on Discord roles but never insert into the `factions` table. Any future code that joins `commanders → factions` will find nothing.
