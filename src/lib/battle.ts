import type Database from 'better-sqlite3';
import type { ArmyRow } from './db.js';

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

export function effectiveStrength(army: Pick<ArmyRow, 'infantry' | 'cavalry' | 'noncombatants'>): number {
  return army.infantry + army.noncombatants + army.cavalry * 2;
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
  army: ArmyRow,
  enemy: ArmyRow,
  isDefender: boolean,
  attackerSpecified: boolean,
): number {
  const myStr = effectiveStrength(army);
  const enemyStr = effectiveStrength(enemy);

  let mod = 0;

  if (myStr > enemyStr) mod += numericalAdvantage(myStr, enemyStr);
  if (army.morale > enemy.morale) mod += army.morale - enemy.morale;
  if (army.supplies === 0) mod -= 1;
  if (isDefender && attackerSpecified) mod += 1;

  return mod;
}

export function resolveBattle(
  database: Database.Database,
  armyAId: number,
  armyBId: number,
  attackerId: number | null,
  rng: () => number = Math.random,
): BattleOutcome | { error: string } {
  const roll2d6 = () => Math.ceil(rng() * 6) + Math.ceil(rng() * 6);
  const roll1d6 = () => Math.ceil(rng() * 6);

  const armyA = database.prepare('SELECT * FROM armies WHERE id = ?').get(armyAId) as ArmyRow | undefined;
  const armyB = database.prepare('SELECT * FROM armies WHERE id = ?').get(armyBId) as ArmyRow | undefined;

  if (!armyA) return { error: `No army with ID ${armyAId}.` };
  if (!armyB) return { error: `No army with ID ${armyBId}.` };
  if (armyA.hex_q !== armyB.hex_q || armyA.hex_r !== armyB.hex_r) {
    return { error: `Armies are not in the same hex.` };
  }

  const attackerIsA = attackerId === armyAId;
  const attackerIsB = attackerId === armyBId;
  const attackerSpecified = attackerIsA || attackerIsB;

  const modA = computeModifier(armyA, armyB, attackerIsB, attackerSpecified);
  const modB = computeModifier(armyB, armyA, attackerIsA, attackerSpecified);

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

  const applyCasualties = (armyId: number, casualtyPct: number, moraleDelta: number) => {
    const factor = (100 - casualtyPct) / 100;
    database
      .prepare(
        `UPDATE armies SET
           infantry      = MAX(0, CAST(ROUND(infantry * ?) AS INTEGER)),
           cavalry       = MAX(0, CAST(ROUND(cavalry * ?) AS INTEGER)),
           noncombatants = MAX(0, CAST(ROUND(noncombatants * ?) AS INTEGER)),
           morale        = MIN(max_morale, MAX(1, morale + ?))
         WHERE id = ?`,
      )
      .run(factor, factor, factor, moraleDelta, armyId);
  };

  if (winner === 'a') {
    applyCasualties(armyAId, victorCasualtyPct, victorMoraleDelta);
    applyCasualties(armyBId, loserCasualtyPct, loserMoraleDelta);
  } else if (winner === 'b') {
    applyCasualties(armyBId, victorCasualtyPct, victorMoraleDelta);
    applyCasualties(armyAId, loserCasualtyPct, loserMoraleDelta);
  } else {
    applyCasualties(armyAId, 5, 0);
    applyCasualties(armyBId, 5, 0);
  }

  if (attackerPenalty) {
    const penaltyId = attackerIsA ? armyAId : armyBId;
    database.prepare('UPDATE armies SET morale = MAX(1, morale - 1) WHERE id = ?').run(penaltyId);
  }

  return {
    sideA: {
      armyId: armyAId,
      name: armyA.name ?? String(armyAId),
      effectiveStrength: effectiveStrength(armyA),
      modifier: modA,
      roll: rollA,
      total: totalA,
    },
    sideB: {
      armyId: armyBId,
      name: armyB.name ?? String(armyBId),
      effectiveStrength: effectiveStrength(armyB),
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
    hexQ: armyA.hex_q,
    hexR: armyA.hex_r,
  };
}
