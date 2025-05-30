// Full bot with fixed /serverinfo timeout and verified player join tracking
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
  new SlashCommandBuilder().setName('joke').setDescription('Get a random AI-generated joke'),
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
  new SlashCommandBuilder().setName('publiccords').setDescription('Show public coordinates'),
  new SlashCommandBuilder().setName('privatecords').setDescription('Show your private coordinates'),
  new SlashCommandBuilder().setName('playersjoined').setDescription('Show all players who ever joined the server'),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Get Minecraft server info (mcstatus.io)')
    .addStringOption(o => {
      o.setName('filter').setDescription('Choose specific info to view').setRequired(false);
      serverInfoChoices.forEach(choice => o.addChoices({ name: choice, value: choice }));
      return o;
    })
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

async function getAIResponse(prompt) {
  try {
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error('AI error:', e);
    return '❌ AI failed.';
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options, member } = interaction;

  if (commandName === 'serverinfo') {
    await interaction.deferReply();
    try {
      const response = await axios.get('https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367');
      const data = response.data;
      const filter = options.getString('filter');

      if (filter) {
        const value = data[filter] || data[filter]?.name || 'N/A';
        return interaction.editReply({
          content: `**${filter}**: 
\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
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
          { name: 'Players', value: `${data.players?.online || 0}/${data.players?.max || '?'}`, inline: true }
        ]
      };
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Server info error:', err);
      return interaction.editReply('❌ Failed to fetch server info.');
    }
  }

  if (commandName === 'playersjoined') {
    const res = await db.query(`SELECT name, first_seen FROM joined_players ORDER BY first_seen ASC`);
    if (!res.rows.length) return interaction.reply('📭 No players have joined yet.');
    const list = res.rows.map(p => `👤 **${p.name}** (since ${new Date(p.first_seen).toLocaleDateString()})`).join('\n');
    return interaction.reply({ content: list.length > 2000 ? 'Too many players to display!' : list });
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
      console.log(`🕒 Server status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

      if (Array.isArray(data.players?.list)) {
        for (const player of data.players.list) {
          console.log('Tracking player:', player.name);
          await db.query('INSERT INTO joined_players (name) VALUES ($1) ON CONFLICT DO NOTHING', [player.name]);
        }
      }

      if (lastStatus === null) {
        lastStatus = isOnline;
        return;
      }

      if (isOnline !== lastStatus) {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
          const statusMsg = isOnline
            ? '🟢 **Server is now ONLINE!**'
            : '🔴 **Server is now OFFLINE.**';
          await channel.send(statusMsg);
        }
        lastStatus = isOnline;
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, 30000);
});

client.login(DISCORD_BOT_TOKEN);
