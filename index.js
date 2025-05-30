// Full bot with all slash commands, full serverinfo filters, logging, and how-to-join help
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const LOG_CHANNEL_ID = '1377938133341180016';

const db = new Pool({ connectionString: DATABASE_URL });

const initDb = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS joined_players (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      first_seen TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cords (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      x INT,
      y INT,
      z INT,
      description TEXT,
      visibility TEXT CHECK (visibility IN ('public', 'private')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

const serverInfoFields = [
  'online', 'host', 'port', 'version', 'players', 'gamemode',
  'edition', 'software', 'plugins', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'
];

const commands = [
  new SlashCommandBuilder().setName('playersjoined').setDescription('Show all players who ever joined the server'),
  new SlashCommandBuilder()
    .setName('savecords')
    .setDescription('Save coordinates')
    .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
    .addIntegerOption(o => o.setName('x').setDescription('X').setRequired(true))
    .addIntegerOption(o => o.setName('y').setDescription('Y').setRequired(true))
    .addIntegerOption(o => o.setName('z').setDescription('Z').setRequired(true))
    .addStringOption(o => o.setName('visibility').setDescription('public or private').setRequired(true)
      .addChoices({ name: 'Public', value: 'public' }, { name: 'Private', value: 'private' }))
    .addStringOption(o => o.setName('description').setDescription('Optional description')),
  new SlashCommandBuilder().setName('privatecords').setDescription('Show your private coordinates'),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Get Minecraft server info')
    .addStringOption(o => {
      o.setName('filter').setDescription('Select specific server info').setRequired(false);
      serverInfoFields.forEach(f => o.addChoices({ name: f, value: f }));
      return o;
    })
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options } = interaction;

  if (commandName === 'serverinfo') {
    await interaction.deferReply();
    try {
      const response = await axios.get('https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367');
      const data = response.data;
      const filter = options.getString('filter');

      if (filter) {
        const result = data[filter] || data.version?.name || data.players || data.motd?.clean || 'Unavailable';
        return interaction.editReply({
          content: `**${filter}**:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
        });
      }

      const embed = {
        title: '🟢 SlxshyNationCraft Server Info',
        color: 0x00ffcc,
        fields: [
          { name: 'Online', value: data.online ? 'Yes' : 'No', inline: true },
          { name: 'Host', value: data.host || 'N/A', inline: true },
          { name: 'Port', value: `${data.port || 'N/A'}`, inline: true },
          { name: 'Version', value: data.version?.name || 'N/A', inline: true },
          { name: 'Players', value: `${data.players?.online || 0}/${data.players?.max || '?'}`, inline: true },
          { name: 'Edition', value: data.edition || 'N/A', inline: true },
          { name: 'MOTD', value: data.motd?.clean || 'N/A', inline: false },
          { name: 'Retrieved At', value: data.retrieved_at || 'N/A', inline: true },
          { name: 'Expires At', value: data.expires_at || 'N/A', inline: true },
          { name: 'EULA Blocked', value: data.eula_blocked ? 'Yes' : 'No', inline: true }
        ]
      };
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Server info error:', err);
      return interaction.editReply('❌ Failed to fetch server info.');
    }
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();

  if (content.includes('how do i join') || content.includes('how to join') || content.includes('join server')) {
    return message.reply(`⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n**Server Name:** SlxshyNationCraft\n**IP:** 87.106.101.66\n**Port:** 6367`);
  }

  if (content.includes('switch') || content.includes('console') || content.includes('xbox') || content.includes('ps4') || content.includes('ps5') || content.includes('phone') || content.includes('mobile')) {
    return message.reply(`📱 **How to Join on Console (Xbox, PlayStation, Switch, Mobile):**\nDownload the **"BedrockTogether"** app on your phone.\nEnter this server:\n**IP:** 87.106.101.66\n**Port:** 6367\nClick "Run".\nThen open Minecraft → Friends tab (or Worlds tab in new UI) → Join via LAN.`);
  }

  if (content.includes('java')) {
    return message.reply(`💻 **Java Edition Notice**:\nSlxshyNationCraft is a **Bedrock-only** server.\nJava Edition players can’t join — sorry!`);
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const statusUrl = 'https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367';
  let lastStatus = null;
  let lastOnlineCount = 0;

  setInterval(async () => {
    try {
      const res = await axios.get(statusUrl);
      const data = res.data;
      const isOnline = data?.online;
      const onlineCount = data.players?.online || 0;
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

      if (lastStatus !== null && isOnline !== lastStatus) {
        const statusMsg = isOnline
          ? '🟢 **Server is now ONLINE!**'
          : '🔴 **Server is now OFFLINE.**';
        if (logChannel?.isTextBased()) await logChannel.send(statusMsg);
        lastStatus = isOnline;
      }
      if (lastStatus === null) lastStatus = isOnline;

      if (onlineCount !== lastOnlineCount) {
        const msg = `👥 **Player Count Changed:** ${lastOnlineCount} → ${onlineCount}`;
        if (logChannel?.isTextBased()) await logChannel.send(msg);
        lastOnlineCount = onlineCount;
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, 30000);
});

client.login(DISCORD_BOT_TOKEN);
