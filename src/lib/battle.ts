import type Database from 'better-sqlite3';
import type { ArmyRow } from './db.js';
import { totalStrength, type ArmySheetStats } from './sheets.js';

export type SideResult = {
  armyId: number;
  name: string;
  effectiveStrength: number;
  modifier: number;
  roll: number;
  total: number;
};

export type BattleOutcome = {
  sideA: SideResult;
  sideB: SideResult;
  winner: 'a' | 'b' | 'draw';
  diff: number;
  impossible: boolean;
  victorCasualtyPct: number;
  loserCasualtyPct: number;
  victorMoraleDelta: number;
  loserMoraleDelta: number;
  attackerPenalty: boolean;
  captureRoll: number | null;
  loserCaptured: boolean;
  hexQ: number;
  hexR: number;
};

export function effectiveStrength(
  stats: Pick<ArmySheetStats, 'detachments' | 'noncombatants'>,
): number {
  return totalStrength(stats) + stats.noncombatants;
}

export function numericalAdvantage(stronger: number, weaker: number): number {
  if (weaker === 0) return 7;
  const ratio = stronger / weaker;
  if (ratio >= 6.0) return 7;
  if (ratio >= 5.0) return 6;
  if (ratio >= 4.0) return 5;
  if (ratio >= 3.0) return 4;
  if (ratio >= 2.0) return 3;
  if (ratio >= 1.5) return 2;
  if (ratio >= 1.25) return 1;
  return 0;
}

function computeModifier(
  s: ArmySheetStats,
  enemy: ArmySheetStats,
  isDefender: boolean,
  attackerSpecified: boolean,
): number {
  const myStr = effectiveStrength(s);
  const enemyStr = effectiveStrength(enemy);

  let mod = 0;

  if (myStr > enemyStr) mod += numericalAdvantage(myStr, enemyStr);
  if (s.morale > enemy.morale) mod += s.morale - enemy.morale;
  if (s.supplies === 0) mod -= 1;
  if (isDefender && attackerSpecified) mod += 1;

  return mod;
}

export function resolveBattle(
  database: Database.Database,
  armyAId: number,
  armyBId: number,
  stats: Map<number, ArmySheetStats>,
  attackerId: number | null,
  rng: () => number = Math.random,
): BattleOutcome | { error: string } {
  const roll2d6 = () => Math.ceil(rng() * 6) + Math.ceil(rng() * 6);
  const roll1d6 = () => Math.ceil(rng() * 6);

  const armyA = database.prepare('SELECT id, name FROM armies WHERE id = ?').get(armyAId) as ArmyRow | undefined;
  const armyB = database.prepare('SELECT id, name FROM armies WHERE id = ?').get(armyBId) as ArmyRow | undefined;

  if (!armyA) return { error: `No army with ID ${armyAId}.` };
  if (!armyB) return { error: `No army with ID ${armyBId}.` };

  const statsA = stats.get(armyAId);
  const statsB = stats.get(armyBId);
  if (!statsA) return { error: `No stats available for army ${armyAId}. Ensure sheet is configured.` };
  if (!statsB) return { error: `No stats available for army ${armyBId}. Ensure sheet is configured.` };

  if (statsA.hex_q !== statsB.hex_q || statsA.hex_r !== statsB.hex_r) {
    return { error: `Armies are not in the same hex.` };
  }

  const attackerIsA = attackerId === armyAId;
  const attackerIsB = attackerId === armyBId;
  const attackerSpecified = attackerIsA || attackerIsB;

  const modA = computeModifier(statsA, statsB, attackerIsB, attackerSpecified);
  const modB = computeModifier(statsB, statsA, attackerIsA, attackerSpecified);

  const rollA = roll2d6();
  const rollB = roll2d6();
  const totalA = rollA + modA;
  const totalB = rollB + modB;

  let winner: 'a' | 'b' | 'draw';
  if (totalA > totalB) winner = 'a';
  else if (totalB > totalA) winner = 'b';
  else if (attackerIsA) winner = 'b';
  else if (attackerIsB) winner = 'a';
  else winner = 'draw';

  const diff = winner === 'draw' ? 0 : Math.abs(totalA - totalB);
  const netModDiff = Math.abs(modA - modB);
  const impossible = netModDiff >= 11;

  let victorCasualtyPct: number;
  let loserCasualtyPct: number;
  let victorMoraleDelta = 0;
  let loserMoraleDelta = 0;
  let attackerPenalty = false;

  if (winner === 'draw') {
    victorCasualtyPct = 5;
    loserCasualtyPct = 5;
  } else if (diff === 0) {
    victorCasualtyPct = 5;
    loserCasualtyPct = 5;
    if (attackerSpecified) attackerPenalty = true;
  } else if (diff === 1) {
    victorCasualtyPct = 10;
    loserCasualtyPct = 10;
    loserMoraleDelta = -1;
  } else if (diff <= 3) {
    victorCasualtyPct = 5;
    loserCasualtyPct = 10;
    loserMoraleDelta = -2;
    if (!impossible) victorMoraleDelta = 1;
  } else if (diff <= 5) {
    victorCasualtyPct = 5;
    loserCasualtyPct = 15;
    loserMoraleDelta = -2;
    if (!impossible) victorMoraleDelta = 2;
  } else {
    victorCasualtyPct = 5;
    loserCasualtyPct = 20;
    loserMoraleDelta = -2;
    if (!impossible) victorMoraleDelta = 2;
  }

  if (impossible) loserCasualtyPct += 10;

  let captureRoll: number | null = null;
  let loserCaptured = false;
  if (winner !== 'draw' && diff >= 4) {
    captureRoll = roll1d6();
    loserCaptured = diff >= 6 ? captureRoll <= 2 : captureRoll <= 1;
  }

  // Casualty percentages are reported but not applied — the GM subtracts them
  // from detachment rows on the army sheets by hand.
  // TODO(uncertain): we may want to automate casualty application in the
  // future (e.g. proportional distribution across detachments), once we know
  // how GMs actually apply them in play.
  const applyMorale = (s: ArmySheetStats, moraleDelta: number) => {
    s.morale = Math.min(s.max_morale, Math.max(1, s.morale + moraleDelta));
  };

  if (winner === 'a') {
    applyMorale(statsA, victorMoraleDelta);
    applyMorale(statsB, loserMoraleDelta);
  } else if (winner === 'b') {
    applyMorale(statsB, victorMoraleDelta);
    applyMorale(statsA, loserMoraleDelta);
  }

  if (attackerPenalty) {
    const penaltyStats = attackerIsA ? statsA : statsB;
    penaltyStats.morale = Math.max(1, penaltyStats.morale - 1);
  }

  return {
    sideA: {
      armyId: armyAId,
      name: armyA.name ?? String(armyAId),
      effectiveStrength: effectiveStrength(statsA),
      modifier: modA,
      roll: rollA,
      total: totalA,
    },
    sideB: {
      armyId: armyBId,
      name: armyB.name ?? String(armyBId),
      effectiveStrength: effectiveStrength(statsB),
      modifier: modB,
      roll: rollB,
      total: totalB,
    },
    winner,
    diff,
    impossible,
    victorCasualtyPct,
    loserCasualtyPct,
    victorMoraleDelta,
    loserMoraleDelta,
    attackerPenalty,
    captureRoll,
    loserCaptured,
    hexQ: statsA.hex_q,
    hexR: statsA.hex_r,
  };
}
