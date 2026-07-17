# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SELLSWORD is a Discord bot for running the Cataphracts play-by-post wargame. The game rules are fully specified in `SELLSWORD (A Catahack).md` — that document is the canonical source of truth for game mechanics.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run bot locally with watch mode (auto-restarts on file changes)
npm start            # run bot without watch mode
npm start -- --paused  # start in pause mode (status queries only, no orders or daily updates)
npm run deploy       # register slash commands with Discord (run once, or after adding/changing commands)
npm run seed                           # seed from map-seed.json (upserts, keeps existing hexes)
npm run seed -- maps/my-map.json      # seed from a specific file
npm run seed -- --clear maps/foo.json # wipe map data then seed fresh
npm run clear-map                      # wipe all hex and stronghold data, no reseed
npm run seed-factions                          # seed from faction-seed.json
npm run seed-factions -- factions/my-game.json # seed from a specific file
npm test             # run all tests (vitest)
npm run typecheck    # type-check without emitting
npm run format       # format all files with Prettier
```

Requires a `.env` file — copy `.env.example` and fill in the three values.

## Data model: seed data vs. game data

There are two categories of data and they have different entry points:

**Seed data** is set once before the game begins and does not change during play. It is loaded via npm scripts and stored in JSON files that are gitignored (copy from the `.example.json` versions). Seed scripts are idempotent — safe to re-run.

- `map-seed.json` → `npm run seed` — hex terrain, settlements, strongholds, roads, rivers
- `faction-seed.json` → `npm run seed-factions` — faction names, role colors, optional doc URLs; also creates the corresponding Discord roles and channel categories

**Game data** is created and updated during play by players (via slash commands) or by the update bot (via the daily tick). It never comes from seed files.

When adding a new feature, decide first which category it belongs to. If it is configuration that an admin sets up before the game starts, it is seed data and belongs in a seed script. If it changes during play, it is game data and belongs in a Discord command or tick processor.

## Ways of working

There are two equally valid outcomes in this project: committing working code, and writing up a clear report when progress is blocked. If something can't move forward — missing credentials, an unresolved design question, an unexpected circumstance — the right move is to document what happened and what's needed, not to push through with assumptions. Surfacing unknowns early is as valuable as shipping code.

Use **red-green-refactor TDD** for all new logic: write a failing test first, make it pass with minimal code, then clean up. Do not write implementation code that isn't covered by a test you wrote first.

When a task is complete, **commit the work using Jujutsu** (`jj describe -m "..."` then `jj new`). Do not leave work uncommitted.

## Version Control

This repo uses **Jujutsu (`jj`)** instead of git. Use `jj` commands for version control operations rather than `git`.

## Code Architecture

`src/index.ts` auto-loads all files from `src/commands/` at startup. To add a new command, create a file in `src/commands/` that exports a default object satisfying the `Command` interface (`src/types.ts`), then run `npm run deploy` to register it with Discord. Set `allowInPause: true` on any command that should work in pause mode.

Key libraries:

- `better-sqlite3` — synchronous SQLite; schema defined in `src/lib/schema.ts`, applied on first import of `src/lib/db.ts`
- `googleapis` — Google Sheets and Drive; credentials configured via `GOOGLE_SERVICE_ACCOUNT_KEY`
- `@resvg/resvg-js` — SVG→PNG rendering (WASM-based, no system lib deps); used by `/map`
- `node-cron` — daily update scheduler (6 AM / 2 PM / 10 PM in `SCHEDULE_TIMEZONE`)

Key lib files:

- `src/lib/tick-processors.ts` — all game-loop functions (consumeSupplies, processMovement, processForage, deliverMessages, etc.); each takes `db: Database.Database` as first param so tests can pass an in-memory DB. This is where game mechanics live.
- `src/lib/schema.ts` — DB schema SQL; imported by db.ts and by tests (`new Database(':memory:'); db.exec(DB_SCHEMA)`)
- `src/lib/daily-update.ts` — thin orchestrator that calls tick-processors functions with the live singleton DB
- `src/lib/admin-notify.ts` — shared helper for posting a message to the admin channel
- `src/lib/faction-ops.ts` — `upsertFaction()` for writing to the factions table (injectable DB, used by seed script and commands)
- `src/lib/faction-sync.ts` — `syncFactions()` creates missing Discord roles/categories and upserts factions into the DB; used by `npm run seed-factions`

Discord commands (in `src/commands/`): `/queue`, `/unqueue`, `/recruit`, `/commission`, `/retire`, `/move`, `/forage`, `/pace`, `/stance`, `/transfer`, `/message`, `/gmping`, `/map`, `/list-armies`, `/drop-army`, `/drop-message`, `/ticknow` (admin), `/teleport` (admin), `/battle` (admin)

## Game Domain (for implementing bot logic)

The rules document defines a real-time (one-to-one with real life) medieval wargame. Key mechanical areas:

- **Armies**: composed of detachments (infantry, cavalry, wagons, noncombatants); tracked with morale, supplies, and size
- **Morale**: ranges 1–12, resting default 9; checked by rolling 2d6 under current morale; failure results vary by roll value (see morale table)
- **Battles**: each side rolls 2d6 and adds modifiers; result difference determines casualties and morale changes; supports multi-army fights (either separately or averaged together)
- **Sieges**: weekly threshold rolls (2d6 vs. threshold); threshold starts at 10/15/20 by stronghold type and degrades -1/week
- **Supplies**: infantry eat 1/day, cavalry 10/day; armies can forage (settlement × 500 per hex, max 5 times before spring)
- **Marching**: 12 miles/day on roads, 6 offroad; forced march 18/day with daily morale check
- **Scouting**: see adjacent hexes by default, +1 hex with cavalry; other scouts visible in range
- **Ships**: fleets follow army rules; warships count double for numerical advantage
- **Commanders**: have traits (20 options) that modify army capabilities; gain traits at age 30 and each decade after

The hex map uses 6-mile hexes. Settlement scores drive recruiting, foraging, and revolt calculations.
