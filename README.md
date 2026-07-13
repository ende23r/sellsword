# SELLSWORD

A Discord bot for running Cataphracts.

## Architecture

Game state (armies, commanders, hex map, orders, forage counts) lives in a local **SQLite** database. The bot is the only writer; nothing else touches it directly.

**Google Sheets** handles the human-readable layer:
- One **admin sheet** with multiple tabs: queue, message log, and a global army overview
- One **army sheet per commander**, copied from a template at commission time, tracking that commander's army stats

The bot reads and writes Sheets via a Google service account. The mapping from Discord user to army sheet (and faction, channel, etc.) is stored in SQLite.

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_APP_ID` | Application ID from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `SCHEDULE_TIMEZONE` | IANA timezone for daily updates (e.g. `America/New_York`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Path to the service account JSON key file |
| `ADMIN_SHEET_ID` | Sheet ID of the admin Google Sheet |
| `ARMY_SHEET_TEMPLATE_ID` | Sheet ID of the army sheet template, copied at commission time |

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

### Run the bot

```
npm install
npm run deploy   # register slash commands (run once, or after adding/changing commands)
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
- **Forage** — queue the army to collect supplies from current and adjacent hexes at the next daily update. Notifies admin if revolt risk.
- **Move** — queue a movement order for the next daily update. Takes a road/off-road parameter.
- **Pace** — set forced march and/or night march flags on the army.
- **Stance** — set the army to block or allow passage by other armies.
- **Transfer** — send supplies, goods, or coin to another army or settlement in the same hex.

## Daily update

Runs three times per day at **6 AM, 2 PM, and 10 PM** in the configured timezone. Each run:

1. Collect forage for armies that queued a forage order (takes the full day; collected at next morning update)
2. Apply movement orders; notify players if armies cross paths or block each other
3. Consume supplies (once per day, at the morning update)
4. Consume coin for mercenary wages
5. Push updated army stats to each commander's army sheet and the admin sheet

## Open questions

- Which commands count as "status queries" in pause mode and are allowed through?
- When a commander is commissioned, does the bot own the copied army sheet via the service account, or does it transfer ownership/sharing to the player? (Affects whether players can edit their own sheet.)
- Map rendering: generated image posted to Discord vs. text/embed representation?
