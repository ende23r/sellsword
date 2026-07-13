# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SELLSWORD is a Discord bot for running the Cataphracts play-by-post wargame. The game rules are fully specified in `SELLSWORD (A Catahack).md` — that document is the canonical source of truth for game mechanics.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run bot locally with watch mode (auto-restarts on file changes)
npm start            # run bot without watch mode
npm run deploy       # register slash commands with Discord (run once, or after adding/changing commands)
npm run typecheck    # type-check without emitting
npm run format       # format all files with Prettier
```

Requires a `.env` file — copy `.env.example` and fill in the three values.

## Ways of working

There are two equally valid outcomes in this project: committing working code, and writing up a clear report when progress is blocked. If something can't move forward — missing credentials, an unresolved design question, an unexpected circumstance — the right move is to document what happened and what's needed, not to push through with assumptions. Surfacing unknowns early is as valuable as shipping code.

## Version Control

This repo uses **Jujutsu (`jj`)** instead of git. Use `jj` commands for version control operations rather than `git`.

## Code Architecture

`src/index.ts` auto-loads all files from `src/commands/` at startup. To add a new command, create a file in `src/commands/` that exports a default object satisfying the `Command` interface (`src/types.ts`), then run `npm run deploy` to register it with Discord.

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
