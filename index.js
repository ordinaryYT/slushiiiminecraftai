// Full bot with server status, player tracking, /playersjoined, and log channel messaging
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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const BLOCKED_ROLE_ID = process.env.BLOCKED_ROLE_ID;
const LOG_CHANNEL_ID = '1377938133341180016';

const db = new Pool({ connectionString: DATABASE_URL });

const initDb = async () => {
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS joined_players (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      first_seen TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

const serverInfoChoices = [
  'online', 'host', 'port', 'version', 'players', 'edition', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'
];

const commands = [
  new SlashCommandBuilder().setName('playersjoined').setDescription('Show all players who ever joined the server')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'playersjoined') {
    try {
      const res = await db.query(`SELECT name, first_seen FROM joined_players ORDER BY first_seen ASC`);
      if (!res.rows.length) return interaction.reply('📭 No players have joined yet.');
      const list = res.rows.map(p => `👤 **${p.name}** (since ${new Date(p.first_seen).toLocaleDateString()})`).join('\n');
      return interaction.reply({ content: list.length > 2000 ? 'Too many players to display!' : list });
    } catch (err) {
      console.error('Error fetching playersjoined:', err);
      return interaction.reply('❌ Failed to fetch joined players.');
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const statusUrl = 'https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367';
  let lastStatus = null;

  setInterval(async () => {
    try {
      const res = await axios.get(statusUrl);
      const data = res.data;
      const isOnline = data?.online;

      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

      if (Array.isArray(data.players?.list)) {
        for (const player of data.players.list) {
          const insert = await db.query('INSERT INTO joined_players (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING *', [player.name]);
          if (insert.rows.length && logChannel?.isTextBased()) {
            await logChannel.send(`🧍 **${player.name}** joined the server for the first time!`);
          }
        }
      }

      if (lastStatus === null) {
        lastStatus = isOnline;
        return;
      }

      if (isOnline !== lastStatus) {
        const statusMsg = isOnline
          ? '🟢 **Server is now ONLINE!**'
          : '🔴 **Server is now OFFLINE.**';
        if (logChannel?.isTextBased()) {
          await logChannel.send(statusMsg);
        }
        lastStatus = isOnline;
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, 30000);
});

client.login(DISCORD_BOT_TOKEN);
