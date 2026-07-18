# SELLSWORD

A Discord bot for running Cataphracts.

## Thesis

**Automate procedurally wherever reasonable; put everything else in Google Sheets for the GM to tinker with.**

If a mechanic can just happen, it does: supplies are eaten, armies march, forage comes in, goods sell to the local market — deterministically, at the daily tick, with no human in the loop. The bot exists to grind through that bookkeeping so nobody has to.

Everything that *isn't* automated is deliberately surfaced in Google Sheets, where a non-technical GM has full control: army composition (detachments with explicit multipliers and strengths, so custom troop types need no code changes), goods inventories, market demands, casualties after a battle, repositioning an army by editing its Hex cell. The bot treats those as GM-owned — it reads them, validates them loudly (`npm run check-sheet`, warnings in the tick log), and never overwrites them, so nothing a GM types can be clobbered. There are no admin commands for things a sheet edit can do.

The line between the two moves over time — when a manual process proves routine enough to automate (as selling goods did), it crosses over — but every mechanic should live clearly on one side or the other.

## Architecture

### Player interaction

The bot separates **player interaction** from **game state changes**:

- **Queries** (read-only): players can ask about their army, the map, pending orders, etc. at any time. These never mutate state.
- **Order submission**: players submit orders at any time. Orders are stored as pending records in SQLite and immediately confirmed to the player. Submitting a new order replaces the previous one.
- **Tick processing**: three times per day, the bot reads all pending orders and current game state, applies game mechanics deterministically, writes the results back, and posts a summary to the admin channel.

Between ticks, game state is frozen. The outcome of any tick is fully determined by: current army state, current pending orders, army settings (pace, stance), and the map. There are no hidden rolls until the tick fires.

Army **settings** (pace, stance) are a special case: they are army properties that players update directly, not queued orders. They take effect during the next tick that reads them.

### Storage

**Google Sheets is the source of truth for army state.** Each commander has an army sheet (copied from a template at commission time) whose contract with the bot is a set of named ranges: scalar stats like morale and position, plus the detachment and goods tables. The bot writes back only the handful of values it changes mechanically (morale, supplies, coin, position, …); the rest is GM-owned. The **admin sheet** carries the shared tabs the GM edits live: queue, message log, and market demands.

**SQLite** holds the rest: the hex map, factions, commanders (including the Discord-user-to-sheet mapping), pending orders, and undelivered messages. The bot is the only writer to the database.

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable                     | Description                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| `DISCORD_TOKEN`              | Bot token from the Discord Developer Portal                    |
| `DISCORD_APP_ID`             | Application ID from the Discord Developer Portal               |
| `DISCORD_GUILD_ID`           | Your Discord server ID                                         |
| `SCHEDULE_TIMEZONE`          | IANA timezone for daily updates (e.g. `America/New_York`)      |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Path to the service account JSON key file                      |
| `ADMIN_SHEET_ID`             | Sheet ID of the admin Google Sheet                             |
| `ARMY_SHEET_TEMPLATE_ID`     | Sheet ID of the army sheet template, copied at commission time |

## Setup

### Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.
2. **Bot tab** → **Add Bot** → copy the **Token** (`DISCORD_TOKEN`).
3. **General Information tab** → copy the **Application ID** (`DISCORD_APP_ID`).
4. In Discord, enable Developer Mode (User Settings → Advanced), then right-click your server → **Copy Server ID** (`DISCORD_GUILD_ID`).
5. **OAuth2 → URL Generator**: check `bot` + `applications.commands`, set the **Send Messages** permission, open the generated URL to invite the bot.

### Google Sheets

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Sheets API** and **Google Drive API**.
2. Create a **service account**, download its JSON key file, and set `GOOGLE_SERVICE_ACCOUNT_KEY` to its path.
3. Create the admin sheet and the army sheet template. Share both with the service account's email (editor access).
4. Set `ADMIN_SHEET_ID` and `ARMY_SHEET_TEMPLATE_ID` to the respective Sheet IDs (the long string in each sheet's URL).

### Discord permissions

The bot needs these permissions in addition to `Send Messages`:

- `Manage Roles` — for `/recruit` (assigning faction roles)
- `Manage Channels` — for `/commission` (creating army channels)

Add them in the OAuth2 → URL Generator step.

### Map

Create the map data file and seed the database:

```
cp map-seed.example.json maps/my-map.json
# edit maps/my-map.json with your hex data
npm run seed -- maps/my-map.json
```

To reseed cleanly (wipes existing hex data first):

```
npm run seed -- --clear maps/my-map.json
```

To wipe map data without reseeding:

```
npm run clear-map
```

### Run the bot

```
npm install
npm run deploy   # register slash commands (run once, or after adding/changing commands)
npm run seed     # load map data (run once, or after editing map-seed.json)
npm run dev      # start the bot
```


## Pause mode

Start the bot with `--paused` to enter pause mode:

```
npm start -- --paused
```

In pause mode the bot responds to status queries but refuses orders, messages, and daily updates.

## Commands

- **Queue** — tag yourself with the queue role; records entry in the admin sheet. Admin can queue any player.
- **Recruit** — take the top player from the queue and add them to a faction and channel. Notifies admin.
- **Commission** — create a Discord channel and copy the army sheet template for a new commander. Notifies admin.
- **Message** — send an in-game message to another hex. Logs to the admin sheet and calculates delivery time based on distance and terrain. Notifies admin.
- **Forage** — queue the army to collect supplies from the current hex and all adjacent hexes at the next night update. Cavalry extends the range to 2 hexes. Cancels any pending move order. Notifies admin if revolt risk.
- **Move** — queue a movement order for the next daily update. Takes a road/off-road parameter.
- **Pace** — set forced march and/or night march flags on the army.
- **Stance** — set the army to block or allow passage by other armies.
- **Transfer** — send supplies, goods, or coin to another army or settlement in the same hex.

## Daily update

Runs three times per day at **6 AM (morning), 2 PM (midday), and 10 PM (night)** in the configured timezone.

All three ticks deliver any in-game messages whose delivery time has passed, then push updated army stats to Google Sheets.

### Morning (6 AM)
- Apply any night march movement from the previous night (armies with night march enabled)
- Deduct daily supply consumption from each army (infantry/noncombatants: 1/day; cavalry/wagons: 10/day); armies that can't pay lose 1 morale

### Midday (2 PM)
- (stats sync and message delivery only)

### Night (10 PM)
- Apply movement orders — movement represents a full day of marching (morning through night); armies advance toward their destination each tick at road speed (2 hexes/day) or off-road speed (1 hex/day)
- Notify if armies share a hex or block each other
- Collect forage for armies that submitted a forage order and **did not** also have a move order (submitting either order cancels the other — players have one live order at a time)

### Night march
If an army has night march enabled, it marches an additional hex overnight (2 if forced march), road only. The army makes a morale check; rolling doubles on 2d6 costs 1 morale.

## Open questions

- Which additional commands should work in pause mode? Currently only `/map` has `allowInPause: true`. Mark any read-only commands in `src/commands/` the same way.
