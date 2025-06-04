// Updated index.js with team support
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
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LOG_CHANNEL_ID = '1377938133341180016';
const TEAMS_CHANNEL_ID = process.env.TEAMS_CHANNEL_ID || LOG_CHANNEL_ID; // Fallback to log channel if not specified

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
      team_id INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_teams (
      user_id TEXT PRIMARY KEY,
      team_id INT REFERENCES teams(id)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS team_requests (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      team_id INT REFERENCES teams(id),
      requested_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

const serverInfoFields = [
  'online', 'host', 'port', 'version', 'players', 'gamemode',
  'edition', 'software', 'plugins', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'
];

const commands = [
  new SlashCommandBuilder().setName('savecords').setDescription('Save coordinates')
    .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
    .addIntegerOption(o => o.setName('x').setDescription('X').setRequired(true))
    .addIntegerOption(o => o.setName('y').setDescription('Y').setRequired(true))
    .addIntegerOption(o => o.setName('z').setDescription('Z').setRequired(true))
    .addStringOption(o => o.setName('visibility').setDescription('public or private').setRequired(true)
      .addChoices({ name: 'Public', value: 'public' }, { name: 'Private', value: 'private' }))
    .addStringOption(o => o.setName('description').setDescription('Optional description')),
  new SlashCommandBuilder().setName('privatecords').setDescription('Show your private coordinates'),
  new SlashCommandBuilder().setName('publiccords').setDescription('Show all public coordinates'),
  new SlashCommandBuilder().setName('playersjoined').setDescription('List all players that joined'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Get Minecraft server info')
    .addStringOption(o => o.setName('filter').setDescription('Filter info').setRequired(false)
      .addChoices(...serverInfoFields.map(f => ({ name: f, value: f })))),
  // New team commands
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('jointeam').setDescription('Request to join a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your team'),
  new SlashCommandBuilder().setName('teamcords').setDescription('See cords for your team')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();

  // AI via mention
  if (message.mentions.has(client.user)) {
    const prompt = message.content.replace(/<@!?\d+>/, '').trim();
    if (!prompt) return message.reply('❌ You must say something.');
    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'openai/gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const reply = res.data.choices[0]?.message?.content || '⚠️ No response.';
      return message.reply(reply);
    } catch (err) {
      console.error('❌ AI Error:', err);
      return message.reply('❌ Failed to contact AI.');
    }
  }

  // Join replies
  if (content.includes('how do i join') || content.includes('how to join') || content.includes('join server')) {
    return message.reply(`⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n**Server Name:** SlxshyNationCraft\n**IP:** 87.106.101.66\n**Port:** 6367`);
  }
  if (content.includes('switch') || content.includes('console') || content.includes('xbox') || content.includes('ps4') || content.includes('ps5') || content.includes('phone') || content.includes('mobile')) {
    return message.reply(`📱 **How to Join on Console (Xbox, PlayStation, Switch, Mobile):**\nDownload the **"BedrockTogether"** app on your phone.\nEnter this server:\n**IP:** 87.106.101.66\n**Port:** 6367\nClick "Run".\nThen open Minecraft → Friends tab (or Worlds tab in new UI) → Join via LAN.`);
  }
  if (content.includes('java')) {
    return message.reply(`💻 **Java Edition Notice**:\nSlxshyNationCraft is a **Bedrock-only** server.\nJava Edition players can't join — sorry!`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options } = interaction;

  if (commandName === 'savecords') {
    await interaction.deferReply({ ephemeral: true });
    const { name, x, y, z, description, visibility } = {
      name: options.getString('name'),
      x: options.getInteger('x'),
      y: options.getInteger('y'),
      z: options.getInteger('z'),
      description: options.getString('description') || 'No description',
      visibility: options.getString('visibility')
    };
    
    // Check if user is in a team
    const teamRes = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
    const teamId = teamRes.rows[0]?.team_id || null;
    
    await db.query(
      `INSERT INTO cords (user_id, name, x, y, z, description, visibility, team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, name, x, y, z, description, visibility, teamId]
    );
    return interaction.editReply(`✅ Saved **${name}** as **${visibility}**.`);
  }

  if (commandName === 'privatecords') {
    await interaction.deferReply({ ephemeral: true });
    const res = await db.query(`SELECT * FROM cords WHERE user_id = $1 AND visibility = 'private'`, [user.id]);
    if (!res.rows.length) return interaction.editReply('📭 No private coordinates.');
    const list = res.rows.map(r => `📍 **${r.name}** (${r.x},${r.y},${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.editReply({ content: list });
  }

  if (commandName === 'publiccords') {
    await interaction.deferReply();
    const res = await db.query(`SELECT * FROM cords WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 10`);
    if (!res.rows.length) return interaction.editReply('📭 No public coordinates.');
    const list = res.rows.map(r => `📍 **${r.name}** (${r.x},${r.y},${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.editReply({ content: list });
  }

  if (commandName === 'playersjoined') {
    const res = await db.query(`SELECT name, first_seen FROM joined_players ORDER BY first_seen ASC`);
    if (!res.rows.length) return interaction.reply('📭 No player records.');
    const list = res.rows.map(r => `👤 ${r.name} - ${new Date(r.first_seen).toLocaleDateString()}`).join('\n');
    return interaction.reply({ content: list });
  }

  if (commandName === 'serverinfo') {
    await interaction.deferReply();
    try {
      const res = await axios.get('https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367');
      const data = res.data;
      const filter = options.getString('filter');
      if (filter && data[filter]) {
        return interaction.editReply(`**${filter}:**\n\`\`\`json\n${JSON.stringify(data[filter], null, 2)}\n\`\`\``);
      }
      const embed = {
        title: 'SlxshyNationCraft Server Info',
        fields: serverInfoFields.map(f => ({ name: f, value: String(data[f] || 'N/A'), inline: true }))
      };
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Failed to fetch server info.');
    }
  }

  // Team commands
  if (commandName === 'createteam') {
    const name = options.getString('name');
    
    // Check if team exists
    const exists = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
    if (exists.rows.length) return interaction.reply({ content: '❌ Team already exists', ephemeral: true });
    
    // Check if user is already in a team
    const inTeam = await db.query('SELECT * FROM user_teams WHERE user_id = $1', [user.id]);
    if (inTeam.rows.length) return interaction.reply({ content: '❌ You are already in a team', ephemeral: true });
    
    try {
      const result = await db.query(
        'INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', 
        [name, user.id]
      );
      
      await db.query(
        'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)',
        [user.id, result.rows[0].id]
      );
      
      // Announce team creation
      if (TEAMS_CHANNEL_ID) {
        const teamsChannel = await client.channels.fetch(TEAMS_CHANNEL_ID);
        if (teamsChannel?.isTextBased()) {
          await teamsChannel.send(`🛡️ New team created: **${name}** by <@${user.id}>`);
        }
      }
      
      return interaction.reply({ content: `✅ Created and joined team **${name}**`, ephemeral: true });
    } catch (err) {
      console.error('Team creation error:', err);
      return interaction.reply({ content: '❌ Failed to create team', ephemeral: true });
    }
  }

  if (commandName === 'jointeam') {
    const name = options.getString('name');
    
    // Check if user is already in a team
    const inTeam = await db.query('SELECT * FROM user_teams WHERE user_id = $1', [user.id]);
    if (inTeam.rows.length) return interaction.reply({ content: '❌ You are already in a team', ephemeral: true });
    
    // Check if team exists
    const res = await db.query('SELECT id FROM teams WHERE name = $1', [name]);
    if (!res.rows.length) return interaction.reply({ content: '❌ No such team', ephemeral: true });
    
    // Check if request already exists
    const existingRequest = await db.query(
      'SELECT * FROM team_requests WHERE user_id = $1 AND team_id = $2',
      [user.id, res.rows[0].id]
    );
    if (existingRequest.rows.length) return interaction.reply({ content: '❌ You already have a pending request', ephemeral: true });
    
    await db.query(
      'INSERT INTO team_requests (user_id, team_id) VALUES ($1, $2)',
      [user.id, res.rows[0].id]
    );
    
    return interaction.reply({ content: '📨 Request sent to join the team', ephemeral: true });
  }

  if (commandName === 'leaveteam') {
    const res = await db.query('DELETE FROM user_teams WHERE user_id = $1 RETURNING *', [user.id]);
    if (!res.rowCount) return interaction.reply({ content: '❌ You are not in a team', ephemeral: true });
    
    return interaction.reply({ content: '👋 Left your team', ephemeral: true });
  }

  if (commandName === 'teamcords') {
    await interaction.deferReply({ ephemeral: true });
    
    // Get user's team
    const team = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
    if (!team.rows.length) return interaction.editReply({ content: '❌ You are not in a team' });
    
    // Get team coordinates
    const cords = await db.query('SELECT * FROM cords WHERE team_id = $1 ORDER BY created_at DESC', [team.rows[0].team_id]);
    if (!cords.rows.length) return interaction.editReply({ content: '📭 No team coordinates' });
    
    const list = cords.rows.map(r => 
      `📍 **${r.name}** (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}\n👤 Saved by <@${r.user_id}>`
    ).join('\n\n');
    
    return interaction.editReply({ content: `### Team Coordinates\n${list}` });
  }
});

client.once('ready', async () => {
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
        const msg = isOnline ? '🟢 Server is now ONLINE!' : '🔴 Server is now OFFLINE.';
        if (logChannel?.isTextBased()) await logChannel.send(msg);
        lastStatus = isOnline;
      }
      if (lastStatus === null) lastStatus = isOnline;

      if (onlineCount !== lastOnlineCount) {
        const msg = `👥 Player Count Changed: ${lastOnlineCount} → ${onlineCount}`;
        if (logChannel?.isTextBased()) await logChannel.send(msg);
        lastOnlineCount = onlineCount;
      }
    } catch (err) {
      console.error('❌ Polling error:', err);
    }
  }, 30000);
});

client.login(DISCORD_BOT_TOKEN);
