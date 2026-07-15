import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DB_SCHEMA } from './schema.js';
import { armyInitials, getArmiesForMap } from './map-render.js';

describe('armyInitials', () => {
  it('takes first letter of alpha words and leading digits of numeric words', () => {
    expect(armyInitials('Orange 1st')).toBe('O1');
  });

  it('takes initials of multi-word alpha names', () => {
    expect(armyInitials('Iron Legion')).toBe('IL');
  });

  it('handles a numeric leading word', () => {
    expect(armyInitials('2nd Army')).toBe('2A');
  });

  it('caps at 3 chars', () => {
    expect(armyInitials('Alpha Beta Gamma Delta')).toBe('ABG');
  });

  it('returns ? for null name', () => {
    expect(armyInitials(null)).toBe('?');
  });

  it('returns ? for empty string', () => {
    expect(armyInitials('')).toBe('?');
  });
});

describe('getArmiesForMap', () => {
  function makeDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(DB_SCHEMA);
    return db;
  }

  it('returns empty array when no armies', () => {
    const db = makeDb();
    expect(getArmiesForMap(db)).toEqual([]);
  });

  it('returns army position, name, and faction color', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO factions (name, discord_role_id, color) VALUES (?, ?, ?)`).run(
      'Orange',
      'role-1',
      '#ff8800',
    );
    const factionId = (db.prepare(`SELECT id FROM factions WHERE discord_role_id = 'role-1'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO commanders (discord_user_id, faction_id) VALUES (?, ?)`).run(
      'user-1',
      factionId,
    );
    const commanderId = (db.prepare(`SELECT id FROM commanders WHERE discord_user_id = 'user-1'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO armies (commander_id, name, hex_q, hex_r) VALUES (?, ?, ?, ?)`).run(
      commanderId,
      'Orange 1st',
      3,
      5,
    );

    const result = getArmiesForMap(db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hex_q: 3,
      hex_r: 5,
      name: 'Orange 1st',
      faction_color: '#ff8800',
    });
  });

  it('returns null faction_color when commander has no faction', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO commanders (discord_user_id) VALUES (?)`).run('user-2');
    const commanderId = (db.prepare(`SELECT id FROM commanders WHERE discord_user_id = 'user-2'`).get() as { id: number }).id;
    db.prepare(`INSERT INTO armies (commander_id, name, hex_q, hex_r) VALUES (?, ?, ?, ?)`).run(
      commanderId,
      'Solo Army',
      1,
      2,
    );

    const result = getArmiesForMap(db);
    expect(result).toHaveLength(1);
    expect(result[0].faction_color).toBeNull();
  });
});
