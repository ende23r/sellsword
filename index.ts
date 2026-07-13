import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Interaction } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'echo') {
    const message = interaction.options.getString('message', true);
    await interaction.reply(message);
  }
});

client.login(process.env.DISCORD_TOKEN);
