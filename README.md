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

### TODO(eric): Google Sheets credentials

The Sheets integration is implemented in `src/lib/sheets.ts` and is used by `/queue`, `/message`, `/commission`, and the daily update. To wire it up:

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project.
2. Enable the **Google Sheets API** and the **Google Drive API**.
3. Go to **IAM & Admin → Service Accounts → Create Service Account**.
4. After creating it, go to **Actions → Manage Keys → Add Key → JSON**. Download the file.
5. Save the JSON key somewhere on disk (e.g. `~/.config/sellsword/service-account.json`) and set `GOOGLE_SERVICE_ACCOUNT_KEY` to that path.
6. Create your admin Google Sheet (with tabs: `Queue`, `Messages`) and your army sheet template.
7. **Share both sheets with the service account.** Open the JSON key file and copy the `client_email` value (looks like `name@project.iam.gserviceaccount.com`). Click **Share** on each sheet, paste that address, and grant **Editor** access. Without this step the bot will get 403 errors when trying to read or write the sheets.
8. Set `ADMIN_SHEET_ID` and `ARMY_SHEET_TEMPLATE_ID` to the Sheet IDs from their URLs.
9. In `src/lib/sheets.ts`, update `ARMY_SHEET_CELLS` to match the cell layout of your army sheet template.

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

Runs three times per day at **6 AM (morning), 2 PM (midday), and 10 PM (night)** in the configured timezone.

### Morning (6 AM)
- Deduct daily supply consumption from each army (infantry/noncombatants: 1/day; cavalry/wagons: 10/day)
- Deduct coin for mercenary wages
- Push updated army stats to each commander's army sheet and the admin sheet

### Midday (2 PM)
- Push updated army stats to each commander's army sheet and the admin sheet

### Night (10 PM)
- Apply movement orders — movement represents a full day of marching (morning through night)
- Notify players if armies share a hex or block each other
- Collect forage for armies that submitted a forage order *and* spent the full day foraging (i.e., no conflicting movement order)
- Push updated army stats to each commander's army sheet and the admin sheet

### Night march
If an army has night march enabled, an additional movement step runs overnight (after the night tick, before morning). Night march comes at a cost: armies must pass a daily morale check or suffer consequences.

## Open questions

- Which additional commands should work in pause mode? Currently only `/map` has `allowInPause: true`. Mark any read-only commands in `src/commands/` the same way.
