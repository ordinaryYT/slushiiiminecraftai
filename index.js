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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      team_id INT
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
  
  // TEAM COMMANDS
  new SlashCommandBuilder().setName('createteam').setDescription('Create a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('jointeam').setDescription('Request to join a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),
  new SlashCommandBuilder().setName('teamcords').setDescription('View your team coordinates')
].map(c => c.toJSON());
if (!interaction.isChatInputCommand()) return;
const { commandName, user, options } = interaction;

// TEAM: Create a team
if (commandName === 'createteam') {
  const name = options.getString('name');
  const existing = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
  if (existing.rows.length) {
    return interaction.reply({ content: '❌ Team already exists.', ephemeral: true });
  }
  const result = await db.query('INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', [name, user.id]);
  await db.query('INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)', [user.id, result.rows[0].id]);
  return interaction.reply(`✅ Team **${name}** created and you joined it.`);
}

// TEAM: Join a team
if (commandName === 'jointeam') {
  const name = options.getString('name');
  const team = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
  if (!team.rows.length) {
    return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
  }
  await db.query('INSERT INTO team_requests (user_id, team_id) VALUES ($1, $2)', [user.id, team.rows[0].id]);
  return interaction.reply('📨 Join request sent. Waiting for approval.');
}

// TEAM: Leave team
if (commandName === 'leaveteam') {
  const result = await db.query('DELETE FROM user_teams WHERE user_id = $1 RETURNING *', [user.id]);
  if (!result.rowCount) return interaction.reply('❌ You are not in a team.');
  return interaction.reply('👋 You have left your team.');
}

// TEAM: View team cords
if (commandName === 'teamcords') {
  await interaction.deferReply();
  const teamRes = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
  if (!teamRes.rows.length) return interaction.editReply('❌ You are not in a team.');
  const cords = await db.query('SELECT * FROM cords WHERE team_id = $1', [teamRes.rows[0].team_id]);
  if (!cords.rows.length) return interaction.editReply('📭 No team coordinates found.');
  const list = cords.rows.map(r => `📍 **${r.name}** (${r.x}, ${r.y}, ${r.z})\\n📝 ${r.description}`).join('\\n\\n');
  return interaction.editReply({ content: list });
}

// SAVE CORDS (with team support)
if (commandName === 'savecords') {
  await interaction.deferReply({ ephemeral: true });
  const name = options.getString('name');
  const x = options.getInteger('x');
  const y = options.getInteger('y');
  const z = options.getInteger('z');
  const description = options.getString('description') || 'No description';
  const visibility = options.getString('visibility');
  const teamRes = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
  const teamId = teamRes.rows[0]?.team_id || null;

  await db.query(
    `INSERT INTO cords (user_id, name, x, y, z, description, visibility, team_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user.id, name, x, y, z, description, visibility, teamId]
  );

  return interaction.editReply(`✅ Saved **${name}** as **${visibility}**.` + (teamId ? ' Linked to your team.' : ''));
}
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    await initDb();
    console.log('✅ Commands registered and database initialized.');
  } catch (err) {
    console.error('❌ Error during startup:', err);
  }
})();

client.login(DISCORD_BOT_TOKEN);
