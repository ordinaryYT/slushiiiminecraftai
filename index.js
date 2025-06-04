// Full index.js with advanced team management, UI embeds, and button interactions
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionType } = require('discord.js');
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
const TEAMS_CHANNEL_ID = '1373394760735133706'; // replace with actual channel ID

const db = new Pool({ connectionString: DATABASE_URL });

const initDb = async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS joined_players (id SERIAL PRIMARY KEY, name TEXT UNIQUE, first_seen TIMESTAMPTZ DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS teams (id SERIAL PRIMARY KEY, name TEXT UNIQUE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS cords (id SERIAL PRIMARY KEY, user_id TEXT, name TEXT, x INT, y INT, z INT, description TEXT, visibility TEXT CHECK (visibility IN ('public', 'private')), team_id INT REFERENCES teams(id), created_at TIMESTAMPTZ DEFAULT NOW());`);
  await db.query(`CREATE TABLE IF NOT EXISTS user_teams (user_id TEXT PRIMARY KEY, team_id INT REFERENCES teams(id));`);
  await db.query(`CREATE TABLE IF NOT EXISTS team_requests (id SERIAL PRIMARY KEY, user_id TEXT, team_id INT REFERENCES teams(id), requested_at TIMESTAMPTZ DEFAULT NOW());`);
};

const serverInfoFields = ['online', 'host', 'port', 'version', 'players', 'gamemode', 'edition', 'software', 'plugins', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'];

const commands = [
  new SlashCommandBuilder().setName('savecords').setDescription('Save coordinates')
    .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
    .addIntegerOption(o => o.setName('x').setDescription('X').setRequired(true))
    .addIntegerOption(o => o.setName('y').setDescription('Y').setRequired(true))
    .addIntegerOption(o => o.setName('z').setDescription('Z').setRequired(true))
    .addStringOption(o => o.setName('visibility').setDescription('public or private').setRequired(true).addChoices({ name: 'Public', value: 'public' }, { name: 'Private', value: 'private' }))
    .addStringOption(o => o.setName('description').setDescription('Optional description')),
  new SlashCommandBuilder().setName('privatecords').setDescription('Show your private coordinates'),
  new SlashCommandBuilder().setName('publiccords').setDescription('Show all public coordinates'),
  new SlashCommandBuilder().setName('playersjoined').setDescription('List all players that joined'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Get Minecraft server info')
    .addStringOption(o => o.setName('filter').setDescription('Filter info').setRequired(false).addChoices(...serverInfoFields.map(f => ({ name: f, value: f })))),
  new SlashCommandBuilder().setName('createteam').setDescription('Create a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('jointeam').setDescription('Request to join a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),
  new SlashCommandBuilder().setName('teamcords').setDescription('View team coordinates')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName, user, options } = interaction;
    if (commandName === 'createteam') {
      const name = options.getString('name');
      const existing = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
      if (existing.rows.length) return interaction.reply({ content: '❌ Team name already exists.', ephemeral: true });
      const res = await db.query('INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', [name, user.id]);
      const teamId = res.rows[0].id;
      await db.query('INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)', [user.id, teamId]);
      const guild = await client.guilds.fetch(GUILD_ID);
      const role = await guild.roles.create({ name: `Team-${name}` });
      const member = await guild.members.fetch(user.id);
      await member.roles.add(role);
      const channel = await guild.channels.create({ name: `team-${name}`, type: 0, permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
      ] });
      const embed = new EmbedBuilder().setTitle(`🌐 Team: ${name}`).setDescription(`👤 Created by <@${user.id}>\n⏳ Waiting for members...`).setColor(0x2ecc71);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`leave_${teamId}`).setLabel('Leave Team').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`approve_${teamId}`).setLabel('Approve Requests').setStyle(ButtonStyle.Primary)
      );
      const teamsChannel = await client.channels.fetch(TEAMS_CHANNEL_ID);
      await teamsChannel.send({ embeds: [embed], components: [row] });
      return interaction.reply(`✅ Created team **${name}**.`);
    }
    if (commandName === 'jointeam') {
      const name = options.getString('name');
      const team = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
      if (!team.rows.length) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      await db.query('INSERT INTO team_requests (user_id, team_id) VALUES ($1, $2)', [user.id, team.rows[0].id]);
      return interaction.reply('⏳ Request sent. Waiting for team approval.');
    }
    if (commandName === 'leaveteam') {
      const res = await db.query('DELETE FROM user_teams WHERE user_id = $1 RETURNING *', [user.id]);
      return interaction.reply(res.rowCount ? '👋 You left the team.' : '❌ You are not in a team.');
    }
    if (commandName === 'savecords') {
      await interaction.deferReply({ ephemeral: true });
      const team = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
      const teamId = team.rows[0]?.team_id || null;
      const name = options.getString('name');
      const x = options.getInteger('x');
      const y = options.getInteger('y');
      const z = options.getInteger('z');
      const desc = options.getString('description') || 'No description';
      const vis = options.getString('visibility');
      await db.query('INSERT INTO cords (user_id, name, x, y, z, description, visibility, team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [user.id, name, x, y, z, desc, vis, teamId]);
      return interaction.editReply(`✅ Saved **${name}** as **${vis}**.`);
    }
    if (commandName === 'teamcords') {
      await interaction.deferReply();
      const team = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
      if (!team.rows.length) return interaction.editReply('❌ Not in a team.');
      const cords = await db.query('SELECT * FROM cords WHERE team_id = $1', [team.rows[0].team_id]);
      if (!cords.rows.length) return interaction.editReply('📭 No team coordinates.');
      const list = cords.rows.map(r => `📍 **${r.name}** (${r.x},${r.y},${r.z})\n📝 ${r.description}`).join('\n\n');
      return interaction.editReply(list);
    }
    if (commandName === 'privatecords') {
      await interaction.deferReply({ ephemeral: true });
      const res = await db.query('SELECT * FROM cords WHERE user_id = $1 AND visibility = $2', [user.id, 'private']);
      return interaction.editReply(res.rows.length ? res.rows.map(r => `📍 ${r.name} (${r.x},${r.y},${r.z}) - ${r.description}`).join('\n') : '📭 No private coordinates.');
    }
    if (commandName === 'publiccords') {
      await interaction.deferReply();
      const res = await db.query('SELECT * FROM cords WHERE visibility = $1 ORDER BY created_at DESC LIMIT 10', ['public']);
      return interaction.editReply(res.rows.length ? res.rows.map(r => `📍 ${r.name} (${r.x},${r.y},${r.z}) - ${r.description}`).join('\n') : '📭 No public coordinates.');
    }
    if (commandName === 'playersjoined') {
      const res = await db.query('SELECT name, first_seen FROM joined_players ORDER BY first_seen ASC');
      return interaction.reply(res.rows.length ? res.rows.map(r => `👤 ${r.name} - ${new Date(r.first_seen).toLocaleDateString()}`).join('\n') : '📭 No player records.');
    }
    if (commandName === 'serverinfo') {
      await interaction.deferReply();
      try {
        const res = await axios.get('https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367');
        const data = res.data;
        const filter = options.getString('filter');
        return interaction.editReply(filter && data[filter] ? `**${filter}:**\n\`\`\`json\n${JSON.stringify(data[filter], null, 2)}\n\`\`\`` : { embeds: [new EmbedBuilder().setTitle('SlxshyNationCraft Server Info').addFields(serverInfoFields.map(f => ({ name: f, value: String(data[f] || 'N/A'), inline: true })))] });
      } catch (e) {
        return interaction.editReply('❌ Failed to fetch server info.');
      }
    }
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const [action, teamId] = interaction.customId.split('_');
    if (action === 'leave') {
      await db.query('DELETE FROM user_teams WHERE user_id = $1 AND team_id = $2', [interaction.user.id, teamId]);
      return interaction.reply({ content: '👋 You left the team.', ephemeral: true });
    }
    if (action === 'approve') {
      const pending = await db.query('SELECT user_id FROM team_requests WHERE team_id = $1', [teamId]);
      if (!pending.rows.length) return interaction.reply({ content: '📭 No pending requests.', ephemeral: true });
      const rows = pending.rows.map(u => `<@${u.user_id}>`).join('\n');
      return interaction.reply({ content: `Pending requests:\n${rows}`, ephemeral: true });
    }
  }
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
