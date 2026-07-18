# Battle System

## Overview

Battles are resolved immediately when the GM runs `/battle`. The bot computes modifiers from army statistics, rolls 2d6 for each side, applies casualties and morale changes, and notifies all parties.

## Trigger

Battles are triggered by **stance**. Each army has one of two stances (set with `/stance`):

- **Allow passage** (default) — the army lets other armies move through its hex without interference.
- **Engage** — the army intercepts enemies that enter its hex, halting their movement there.

When a moving army's path passes through a hex occupied by an enemy army in **engage** stance, the moving army is stopped in that hex at the end of the tick. After all movement resolves, `checkArmyCollisions` posts an ⚔️ **ENGAGE** notice to the admin channel naming the intercepting army.

The GM then runs `/battle` to resolve the fight. The engaging army should be treated as the attacker (use `attacker_id`).

Armies from the **same faction** never trigger an engage, even if the stance is set to engage. Two armies that are both in allow-passage stance and happen to share a hex do not trigger a battle notice.

## Command

```
/battle army_a:<id> army_b:<id> [attacker_id:<id>]
```

- `army_a`, `army_b`: IDs of the two opposing armies. Both must be in the same hex.
- `attacker_id`: Optional. The army that initiated the engagement. The other becomes the defender and gains +1 (chosen battlefield).

## Modifiers (auto-computed)

For each army:

| Modifier | Condition | Amount |
|---|---|---|
| Numerical advantage | Larger effective strength | +1 to +7 (see table) |
| Morale advantage | Higher morale | +1 per point above enemy |
| Undersupplied | supplies = 0 | −1 |
| Chosen battlefield | Designated defender | +1 |

**Effective strength** = infantry + noncombatants + cavalry × 2.

**Numerical advantage thresholds** (stronger ÷ weaker):

| Ratio | Bonus |
|---|---|
| ≥ 1.25× | +1 |
| ≥ 1.50× | +2 |
| ≥ 2.00× | +3 |
| ≥ 3.00× | +4 |
| ≥ 4.00× | +5 |
| ≥ 5.00× | +6 |
| ≥ 6.00× | +7 |

Tactics, weather, and terrain modifiers are not implemented in this version.

## Resolution

1. Compute total modifier for each side.
2. Roll 2d6 for each side and add modifier → total.
3. Higher total wins. Ties: if an attacker was declared, the defender holds (diff 0); otherwise it is a draw.

## Results by total difference

| Diff | Victor casualties | Loser casualties | Morale | Capture |
|---|---|---|---|---|
| 0 (draw / defender holds) | 5% | 5% | Attacker −1 morale (if any) | — |
| 1 | 10% | 10% | Loser −1 | — |
| 2–3 | 5% | 10% | Victor +1, Loser −2 | — |
| 4–5 | 5% | 15% | Victor +2, Loser −2 | 1-in-6 loser captured |
| 6+ | 5% | 20% | Victor +2, Loser −2 | 2-in-6 loser captured |

**Impossible battle** (net modifier gap ≥ 11): loser takes +10% extra casualties and the victor gains no morale.

Casualties reduce infantry, cavalry, and noncombatants proportionally (rounded, floor 0). Wagons are unaffected. Morale is clamped to [1, max_morale].

## After the battle

1. The bot posts a full breakdown to the admin channel and a brief summary to each army's Discord channel.
2. The losing army must retreat 1 hex — the GM moves them with `/teleport`.
3. The losing commander should then roll a morale check per the rules (GM handles this).

## Example

**Armies meet:** After the night tick, admin log shows:
> ⚔️ Multiple armies at (4,−2): **Iron Legion**, **Black Company**

**GM declares:**
```
/battle army_a:3 army_b:7 attacker_id:7
```

Black Company (ID 7) is the attacker; Iron Legion (ID 3) is the defender.

**Armies:**
| Army | Infantry | Cavalry | NC | Effective | Morale | Supplies |
|---|---|---|---|---|---|---|
| Iron Legion | 2000 | 400 | 600 | 3400 | 9 | 50 000 |
| Black Company | 1500 | 200 | 400 | 2300 | 8 | 0 |

**Modifiers:**

Iron Legion: +1 (numerical: 3400 ÷ 2300 = 1.47×) + 1 (morale: 9 − 8) + 1 (chosen battlefield) = **+3**

Black Company: −1 (undersupplied) = **−1**

Net modifier gap: 4. Not impossible.

**Rolls (example):** Iron Legion rolls 7 → total **10**. Black Company rolls 5 → total **4**. Diff: **6**.

**Results:**
- Iron Legion: 5% casualties, +2 morale
- Black Company: 20% casualties, −2 morale, 2-in-6 capture roll → 4 (not captured)

**Admin channel output:**
```
⚔️ BATTLE at (4,−2) — Iron Legion vs Black Company
Iron Legion  roll 7 + 3 = 10  |  Black Company  roll 5 − 1 = 4  |  Diff: 6
🏆 Iron Legion — 5% casualties, morale +2
💀 Black Company — 20% casualties, morale −2 | Capture roll: 4 — not captured
⚠️ Black Company must retreat 1 hex. Use /teleport to move them.
```

**Army channels:**
- Iron Legion channel: "⚔️ Battle at (4,−2): you defeated **Black Company** — 5% casualties, morale +2."
- Black Company channel: "⚔️ Battle at (4,−2): you were defeated by **Iron Legion** — 20% casualties, morale −2. Await GM retreat orders."
