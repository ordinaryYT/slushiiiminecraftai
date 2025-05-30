// Full bot with /savecords, /publiccords, /privatecords, /serverinfo, join help, and logging
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
  new SlashCommandBuilder().setName('publiccords').setDescription('Show all public coordinates'),
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

  if (commandName === 'publiccords') {
    await interaction.deferReply();
    const res = await db.query(`SELECT * FROM cords WHERE visibility = 'public' ORDER BY created_at DESC`);
    if (!res.rows.length) return interaction.editReply('📭 No public cords found.');
    const list = res.rows.map(r => `📍 **${r.name}** - (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.editReply({ content: list });
  }

  if (commandName === 'savecords') {
    await interaction.deferReply({ ephemeral: true });
    await db.query(`INSERT INTO cords (user_id, name, x, y, z, description, visibility)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, options.getString('name'), options.getInteger('x'), options.getInteger('y'), options.getInteger('z'), options.getString('description') || 'No description', options.getString('visibility')]);
    return interaction.editReply(`✅ Saved **${options.getString('name')}** as **${options.getString('visibility')}**.`);
  }

  if (commandName === 'privatecords') {
    await interaction.deferReply({ ephemeral: true });
    const res = await db.query(`SELECT * FROM cords WHERE user_id = $1 AND visibility = 'private' ORDER BY created_at DESC`, [user.id]);
    if (!res.rows.length) return interaction.editReply('📭 No private cords found.');
    const list = res.rows.map(r => `📍 **${r.name}** - (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.editReply({ content: list });
  }

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
