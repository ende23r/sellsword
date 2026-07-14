# TODOs

Places where the code diverges from the architecture or the rules.

---

## Architecture gaps

**`/transfer` executes immediately** (`src/commands/transfer.ts:70–75`)
Resources move between armies the moment the command is issued, not at the next tick. This is the only player-facing command that mutates army state outside of a tick. Whether this is intentional (a physical handoff is instant) or a gap is worth deciding deliberately.

**Messages are stored but never delivered** (`src/lib/daily-update.ts`, `src/commands/message.ts`)
The `messages` table records `delivers_at`, but no tick ever checks that field, sets `delivered = 1`, or notifies the recipient's Discord channel. Messages are currently logged to Sheets and the admin channel at send time, but the recipient never receives them in-game.

**Forage orders persist indefinitely when blocked by movement** (`src/lib/daily-update.ts:processForage`)
If a player queues a forage order and then moves every night, the forage order stays pending forever — it is never executed and never cancelled. A forage order should either expire after one tick where the army moved, or the player should be warned at order submission if they also have a pending move order.

---

## Rule compliance gaps

**Forage only covers the current hex** (`src/lib/daily-update.ts:processForage`, `src/commands/forage.ts`)
The rules say an army forages its current hex and all adjacent hexes (~10-mile radius), and `forage_count` should be incremented on each foraged hex. Cavalry extends the range to 2 hexes away (~15-mile radius). Currently only the current hex is foraged and incremented.

**Forage revolt risk threshold is off** (`src/commands/forage.ts:41`)
`revoltRisk = hex.forage_count >= 3` warns starting on the 4th forage. The rules say the 2nd forage carries a 2-in-6 revolt chance, so the threshold should be `>= 1`. The 3-in-6 chance (unfriendly territory) would need a separate check.

**Revolt is warned about but never rolled** (`src/commands/forage.ts`, `src/lib/daily-update.ts`)
The forage command warns the admin when revolt risk is elevated, but the actual 2d6 roll and revolt army creation are never performed. The daily update's forage processing should roll for revolt when `forage_count >= 1` and apply the result.

**No coin consumption for mercenary wages** (`src/lib/daily-update.ts:consumeSupplies`)
The rules specify monthly wages (1 coin/infantry/month, 10 coin/cavalry/month, 100 coin/ship/month), and unpaid mercenaries lose 3 morale and check morale. Nothing deducts coin at any tick.

**Supply carry capacity not enforced** (`src/lib/db.ts`, `src/lib/daily-update.ts`)
The rules specify maximum carry capacity (15 supplies/infantry+noncombatant, 75/cavalry, 1000/wagon). No command or tick enforces this cap. Armies can accumulate unlimited supplies.

**River crossings not implemented** (`src/lib/daily-update.ts:advanceArmy`)
The rules say fording a river (not a bridge) costs half a day per mile of infantry column. The movement code crosses river edges without any cost or check. Road/bridge crossings should bypass the penalty.

**Long column penalty not implemented** (`src/lib/daily-update.ts:advanceArmy`)
Armies stretching over 6 miles of road travel at half speed. Column length = (infantry + noncombatants) / 5000 + cavalry / 2000 + wagons / 50 miles. The movement code applies no penalty regardless of army size.

**Night march: wrong path at road forks not implemented** (`src/lib/daily-update.ts:processNightMarchMovement`)
The rules specify a 2-in-6 chance of taking the wrong path at a fork during a night march. No fork detection or rerouting logic exists.

**Skirmishers not counted for extended scouting range** (`src/commands/map.ts:44`)
The rules say skirmishers act as cavalry for scouting. The map command checks `army.cavalry > 0` only; it should also check for skirmisher detachments (type `'skirmisher'` in the `detachments` table).

**Road connectivity not verified during movement** (`src/lib/daily-update.ts:advanceArmy`)
`findPath` does a BFS through all valid hex coordinates without checking road edges. When `roads_only = true`, the path is not constrained to road-connected hexes — it just uses road speed while potentially crossing off-road terrain.

**`/map` shows all army positions regardless of fog of war** (`src/commands/map.ts:49`)
`armyPositions: armies` passes every army to the renderer. Players should only see armies within their scouting range (same filter already applied to visible hex terrain).

---

## Missing commands

**No `/rest` command**
The rules have a detailed rest mechanic (weekly morale recovery, morale payment in towns/cities, noncombatant reset). The `orders` table supports `type = 'rest'` but no command creates rest orders and no tick processes them.

**No `/torch` command**
The rules allow armies to spend a day torching hexes (removes forage until spring, revolt risk). The `orders` table supports `type = 'torch'` but no command or tick handles it.

---

## Data model gaps

**`commission` does not set `faction_id` on the commander** (`src/commands/commission.ts:75–82`)
The `commanders.faction_id` foreign key exists in the schema but is never written. The commander's faction is only implied by their Discord role.

**`factions` table is never populated** (`src/commands/recruit.ts`, `src/commands/commission.ts`)
Both `/recruit` and `/commission` operate on Discord roles but never insert into the `factions` table. Any future code that joins `commanders → factions` will find nothing.

---

## Stale text

**`/forage` description says "morning update"** (`src/commands/forage.ts:8,43`)
The command description and confirmation message both reference the morning update, but forage is now processed at the night tick.
