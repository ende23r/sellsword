# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SELLSWORD is a Discord bot for running the Cataphracts play-by-post wargame. The game rules are fully specified in `SELLSWORD (A Catahack).md` — that document is the canonical source of truth for game mechanics.

## Commands

```bash
npm install          # install dependencies
npm run deploy       # register slash commands with Discord (run once, or after adding commands)
npm start            # run the bot locally
```

Requires a `.env` file — copy `.env.example` and fill in the three values.

## Version Control

This repo uses **Jujutsu (`jj`)** instead of git. Use `jj` commands for version control operations rather than `git`.

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
