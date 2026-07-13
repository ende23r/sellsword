# SELLSWORD

A Discord bot for running Cataphracts.

## Setup

### 1. Create a Discord application

Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.

### 2. Create a bot and get credentials

- **Bot tab** → **Add Bot** → copy the **Token** (`DISCORD_TOKEN`)
- **General Information tab** → copy the **Application ID** (`DISCORD_APP_ID`)

### 3. Get your server ID

In Discord, enable Developer Mode (User Settings → Advanced), then right-click your server → **Copy Server ID** (`DISCORD_GUILD_ID`).

### 4. Invite the bot

Go to **OAuth2 → URL Generator**, check `bot` + `applications.commands`, set the **Send Messages** permission, then open the generated URL to add the bot to your server.

### 5. Configure environment

```
cp .env.example .env
# fill in the three values
```

### 6. Install and run

```
npm install
npm run deploy   # register slash commands (run once, or after adding commands)
npm run dev      # start the bot
```
