require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LOG_CHANNEL_ID = '1377938133341180016';
const TEAMS_CHANNEL_ID = process.env.TEAMS_CHANNEL_ID || LOG_CHANNEL_ID;

const db = new Pool({ connectionString: DATABASE_URL });

const initDb = async () => {
  await db.query(
    CREATE TABLE IF NOT EXISTS joined_players (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      first_seen TIMESTAMPTZ DEFAULT NOW()
    );
  );
  await db.query(
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
  );
  await db.query(
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  );
  await db.query(
    CREATE TABLE IF NOT EXISTS user_teams (
      user_id TEXT PRIMARY KEY,
      team_id INT REFERENCES teams(id)
    );
  );
  await db.query(
    CREATE TABLE IF NOT EXISTS team_requests (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      team_id INT REFERENCES teams(id),
      requested_at TIMESTAMPTZ DEFAULT NOW()
    );
  );
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
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('jointeam').setDescription('Request to join a team')
    .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your team'),
  new SlashCommandBuilder().setName('teamcords').setDescription('See cords for your team'),
  new SlashCommandBuilder().setName('teaminfo').setDescription('Get info about your team')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

// Message handling
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();
 // AI response (OrdinaryAI)
  if (message.mentions.has(client.user)) {
    const prompt = message.content.replace(/<@!?\d+>/, '').trim();
    if (!prompt) return message.reply('❌ You must say something.');

    const blocked = [
      'what model are you',
      'who is your provider',
      'are you gpt',
      'are you openai',
      'are you llama',
      'are you meta',
      'what ai is this',
      'which company made you'
    ];

    if (blocked.some(p => prompt.toLowerCase().includes(p))) {
      return message.reply("I'm **OrdinaryAI**, your friendly assistant! Let’s focus on your question 😊");
    }
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
          Authorization: Bearer ${OPENROUTER_API_KEY},
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
    return message.reply(⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n**Server Name:** SlxshyNationCraft\n**IP:** 87.106.101.66\n**Port:** 6367);
  }
  if (content.includes('switch') || content.includes('console') || content.includes('xbox') || content.includes('ps4') || content.includes('ps5') || content.includes('phone') || content.includes('mobile')) {
    return message.reply(📱 **How to Join on Console (Xbox, PlayStation, Switch, Mobile):**\nDownload the **"BedrockTogether"** app on your phone.\nEnter this server:\n**IP:** 87.106.101.66\n**Port:** 6367\nClick "Run".\nThen open Minecraft → Friends tab (or Worlds tab in new UI) → Join via LAN.);
  }
  if (content.includes('java')) {
    return message.reply(💻 **Java Edition Notice**:\nSlxshyNationCraft is a **Bedrock-only** server.\nJava Edition players can't join — sorry!);
  }
});

// Slash command handling
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  
  const { commandName, user, options } = interaction;

  try {
    switch (commandName) {
      case 'savecords':
        await handleSaveCords(interaction, user, options);
        break;
      case 'privatecords':
        await handlePrivateCords(interaction, user);
        break;
      case 'publiccords':
        await handlePublicCords(interaction);
        break;
      case 'playersjoined':
        await handlePlayersJoined(interaction);
        break;
      case 'serverinfo':
        await handleServerInfo(interaction, options);
        break;
      case 'createteam':
        await handleCreateTeam(interaction, user, options);
        break;
      case 'jointeam':
        await handleJoinTeam(interaction, user, options);
        break;
      case 'leaveteam':
        await handleLeaveTeam(interaction, user);
        break;
      case 'teamcords':
        await handleTeamCords(interaction, user);
        break;
      case 'teaminfo':
        await handleTeamInfo(interaction, user);
        break;
      default:
        await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error(Error handling command ${commandName}:, error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred while processing your command', ephemeral: true });
    }
  }
});

// Command handlers
async function handleSaveCords(interaction, user, options) {
  await interaction.deferReply({ ephemeral: true });
  const { name, x, y, z, description, visibility } = {
    name: options.getString('name'),
    x: options.getInteger('x'),
    y: options.getInteger('y'),
    z: options.getInteger('z'),
    description: options.getString('description') || 'No description',
    visibility: options.getString('visibility')
  };
  
  const teamRes = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
  const teamId = teamRes.rows[0]?.team_id || null;
  
  await db.query(
    INSERT INTO cords (user_id, name, x, y, z, description, visibility, team_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8),
    [user.id, name, x, y, z, description, visibility, teamId]
  );
  await interaction.editReply(✅ Saved **${name}** as **${visibility}**.);
}

async function handlePrivateCords(interaction, user) {
  await interaction.deferReply({ ephemeral: true });
  const res = await db.query(SELECT * FROM cords WHERE user_id = $1 AND visibility = 'private', [user.id]);
  if (!res.rows.length) return interaction.editReply('📭 No private coordinates.');
  const list = res.rows.map(r => 📍 **${r.name}** (${r.x},${r.y},${r.z})\n📝 ${r.description}).join('\n\n');
  await interaction.editReply({ content: list });
}

async function handlePublicCords(interaction) {
  await interaction.deferReply();
  const res = await db.query(SELECT * FROM cords WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 10);
  if (!res.rows.length) return interaction.editReply('📭 No public coordinates.');
  const list = res.rows.map(r => 📍 **${r.name}** (${r.x},${r.y},${r.z})\n📝 ${r.description}).join('\n\n');
  await interaction.editReply({ content: list });
}

async function handlePlayersJoined(interaction) {
  const res = await db.query(SELECT name, first_seen FROM joined_players ORDER BY first_seen ASC);
  if (!res.rows.length) return interaction.reply('📭 No player records.');
  const list = res.rows.map(r => 👤 ${r.name} - ${new Date(r.first_seen).toLocaleDateString()}).join('\n');
  await interaction.reply({ content: list });
}

async function handleServerInfo(interaction, options) {
  await interaction.deferReply();
  try {
    const res = await axios.get('https://api.mcstatus.io/v2/status/bedrock/87.106.101.66:6367');
    const data = res.data;
    const filter = options.getString('filter');
    if (filter && data[filter]) {
      return interaction.editReply(**${filter}:**\n\\\json\n${JSON.stringify(data[filter], null, 2)}\n\\\);
    }
    const embed = {
      title: 'SlxshyNationCraft Server Info',
      fields: serverInfoFields.map(f => ({ name: f, value: String(data[f] || 'N/A'), inline: true }))
    };
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply('❌ Failed to fetch server info.');
  }
}

async function handleCreateTeam(interaction, user, options) {
  const name = options.getString('name');
  
  const exists = await db.query('SELECT * FROM teams WHERE name = $1', [name]);
  if (exists.rows.length) return interaction.reply({ content: '❌ Team already exists', ephemeral: true });
  
  const inTeam = await db.query('SELECT * FROM user_teams WHERE user_id = $1', [user.id]);
  if (inTeam.rows.length) return interaction.reply({ content: '❌ You are already in a team', ephemeral: true });
  
  const result = await db.query(
    'INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', 
    [name, user.id]
  );
  
  await db.query(
    'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)',
    [user.id, result.rows[0].id]
  );
  
  // Create team embed
  const embed = new EmbedBuilder()
    .setTitle(🛡️ New Team: ${name})
    .setDescription(**Team Leader:** <@${user.id}>\n**Members:** <@${user.id}>\n\nUse the buttons below to manage your team!)
    .setColor(0x00ff00)
    .setFooter({ text: Team created at ${new Date().toLocaleString()} });
  
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('leave_team')
        .setLabel('Leave Team')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('approve_requests')
        .setLabel('Approve Requests')
        .setStyle(ButtonStyle.Success)
    );
  
  // Send to teams channel
  const teamsChannel = await client.channels.fetch(TEAMS_CHANNEL_ID);
  if (teamsChannel?.isTextBased()) {
    await teamsChannel.send({ 
      content: 🛡️ New team **${name}** has been created!,
      embeds: [embed],
      components: [row] 
    });
  }
  
  await interaction.reply({ 
    content: ✅ Created and joined team **${name}**, 
    ephemeral: true 
  });
}

async function handleJoinTeam(interaction, user, options) {
  const name = options.getString('name');
  
  const inTeam = await db.query('SELECT * FROM user_teams WHERE user_id = $1', [user.id]);
  if (inTeam.rows.length) return interaction.reply({ content: '❌ You are already in a team', ephemeral: true });
  
  const res = await db.query('SELECT id, created_by FROM teams WHERE name = $1', [name]);
  if (!res.rows.length) return interaction.reply({ content: '❌ No such team', ephemeral: true });
  
  const existingRequest = await db.query(
    'SELECT * FROM team_requests WHERE user_id = $1 AND team_id = $2',
    [user.id, res.rows[0].id]
  );
  if (existingRequest.rows.length) return interaction.reply({ content: '❌ You already have a pending request', ephemeral: true });
  
  await db.query(
    'INSERT INTO team_requests (user_id, team_id) VALUES ($1, $2)',
    [user.id, res.rows[0].id]
  );
  
  // Notify team leader
  try {
    const leader = await interaction.guild.members.fetch(res.rows[0].created_by);
    if (leader) {
      await leader.send(📨 New join request for team **${name}** from <@${user.id}>!\nUse the "Approve Requests" button in the team channel to review.);
    }
  } catch (err) {
    console.error('Failed to notify team leader:', err);
  }
  
  await interaction.reply({ content: '📨 Request sent to join the team', ephemeral: true });
}

async function handleLeaveTeam(interaction, user) {
  const res = await db.query('DELETE FROM user_teams WHERE user_id = $1 RETURNING *', [user.id]);
  if (!res.rowCount) return interaction.reply({ content: '❌ You are not in a team', ephemeral: true });
  
  await interaction.reply({ content: '👋 Left your team', ephemeral: true });
}

async function handleTeamCords(interaction, user) {
  await interaction.deferReply({ ephemeral: true });
  
  const team = await db.query('SELECT team_id FROM user_teams WHERE user_id = $1', [user.id]);
  if (!team.rows.length) return interaction.editReply({ content: '❌ You are not in a team' });
  
  const cords = await db.query('SELECT * FROM cords WHERE team_id = $1 ORDER BY created_at DESC', [team.rows[0].team_id]);
  if (!cords.rows.length) return interaction.editReply({ content: '📭 No team coordinates' });
  
  const list = cords.rows.map(r => 
    📍 **${r.name}** (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}\n👤 Saved by <@${r.user_id}>
  ).join('\n\n');
  
  await interaction.editReply({ content: ### Team Coordinates\n${list} });
}

async function handleTeamInfo(interaction, user) {
  await interaction.deferReply({ ephemeral: true });
  
  const teamRes = await db.query(
    SELECT t.* 
    FROM teams t
    JOIN user_teams ut ON t.id = ut.team_id
    WHERE ut.user_id = $1
  , [user.id]);
  
  if (!teamRes.rows.length) return interaction.editReply({ content: '❌ You are not in a team' });
  
  const members = await db.query('SELECT user_id FROM user_teams WHERE team_id = $1', [teamRes.rows[0].id]);
  const requests = await db.query('SELECT COUNT(*) FROM team_requests WHERE team_id = $1', [teamRes.rows[0].id]);
  
  const embed = new EmbedBuilder()
    .setTitle(🛡️ Team ${teamRes.rows[0].name})
    .setDescription(**Leader:** <@${teamRes.rows[0].created_by}>\n**Created:** ${new Date(teamRes.rows[0].created_at).toLocaleString()})
    .addFields(
      { name: 'Members', value: members.rows.map(m => <@${m.user_id}>).join('\n'), inline: true },
      { name: 'Pending Requests', value: requests.rows[0].count.toString(), inline: true }
    )
    .setColor(0x00ff00)
    .setFooter({ text: Use /teamcords to view team coordinates });
  
  await interaction.editReply({ embeds: [embed] });
}

// Button interaction handler
async function handleButtonInteraction(interaction) {
  const { customId, user, message } = interaction;
  
  try {
    await interaction.deferReply({ ephemeral: true });
    
    if (customId === 'leave_team') {
      const teamRes = await db.query('DELETE FROM user_teams WHERE user_id = $1 RETURNING *', [user.id]);
      if (!teamRes.rowCount) return interaction.editReply({ content: '❌ You are not in a team' });
      
      const remainingMembers = await db.query('SELECT * FROM user_teams WHERE team_id = $1', [teamRes.rows[0].team_id]);
      if (remainingMembers.rows.length === 0) {
        await db.query('DELETE FROM teams WHERE id = $1', [teamRes.rows[0].team_id]);
        await db.query('DELETE FROM team_requests WHERE team_id = $1', [teamRes.rows[0].team_id]);
        await message.edit({ 
          content: '⚠️ This team has been disbanded as all members left.',
          embeds: [],
          components: [] 
        });
      } else {
        const teamInfo = await db.query('SELECT * FROM teams WHERE id = $1', [teamRes.rows[0].team_id]);
        const members = await db.query('SELECT user_id FROM user_teams WHERE team_id = $1', [teamRes.rows[0].team_id]);
        
        const embed = new EmbedBuilder()
          .setTitle(🛡️ Team: ${teamInfo.rows[0].name})
          .setDescription(**Team Leader:** <@${teamInfo.rows[0].created_by}>\n**Members:** ${members.rows.map(m => <@${m.user_id}>).join(', ')})
          .setColor(0x00ff00)
          .setFooter({ text: Last updated at ${new Date().toLocaleString()} });
        
        await message.edit({ embeds: [embed] });
      }
      
      await interaction.editReply({ content: '👋 You have left the team' });
    }
    
    if (customId === 'approve_requests') {
      const teamRes = await db.query(
        SELECT t.id 
        FROM teams t
        JOIN user_teams ut ON t.id = ut.team_id
        WHERE t.created_by = $1 AND ut.user_id = $1
      , [user.id]);
      
      if (!teamRes.rows.length) return interaction.editReply({ content: '❌ Only team leaders can approve requests' });
      
      const requests = await db.query(
        SELECT tr.user_id, u.username 
        FROM team_requests tr
        JOIN users u ON tr.user_id = u.id
        WHERE tr.team_id = $1
      , [teamRes.rows[0].id]);
      
      if (!requests.rows.length) return interaction.editReply({ content: '📭 No pending requests' });
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('approve_request_select')
        .setPlaceholder('Select requests to approve')
        .setMinValues(1)
        .setMaxValues(requests.rows.length)
        .addOptions(requests.rows.map(r => ({
          label: r.username,
          description: User ID: ${r.user_id},
          value: r.user_id
        })));
      
      const actionRow = new ActionRowBuilder().addComponents(selectMenu);
      
      await interaction.editReply({ 
        content: 'Select which requests to approve:', 
        components: [actionRow]
      });
    }
  } catch (error) {
    console.error('Button interaction error:', error);
    await interaction.editReply({ content: '❌ An error occurred', ephemeral: true });
  }
}

// Select menu interaction handler
async function handleSelectMenuInteraction(interaction) {
  if (interaction.customId !== 'approve_request_select') return;
  
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const teamRes = await db.query(
      SELECT t.id, t.name
      FROM teams t
      JOIN user_teams ut ON t.id = ut.team_id
      WHERE t.created_by = $1 AND ut.user_id = $1
    , [interaction.user.id]);
    
    if (!teamRes.rows.length) return interaction.editReply({ content: '❌ Only team leaders can approve requests' });
    
    for (const userId of interaction.values) {
      try {
        await db.query('INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)', [userId, teamRes.rows[0].id]);
        await db.query('DELETE FROM team_requests WHERE user_id = $1 AND team_id = $2', [userId, teamRes.rows[0].id]);
        
        const member = await interaction.guild.members.fetch(userId);
        if (member) {
          await member.send(🎉 Your request to join team **${teamRes.rows[0].name}** has been approved!);
        }
      } catch (err) {
        console.error(Failed to add user ${userId} to team:, err);
      }
    }
    
    const members = await db.query('SELECT user_id FROM user_teams WHERE team_id = $1', [teamRes.rows[0].id]);
    const teamInfo = await db.query('SELECT * FROM teams WHERE id = $1', [teamRes.rows[0].id]);
    
    const embed = new EmbedBuilder()
      .setTitle(🛡️ Team: ${teamInfo.rows[0].name})
      .setDescription(**Team Leader:** <@${teamInfo.rows[0].created_by}>\n**Members:** ${members.rows.map(m => <@${m.user_id}>).join(', ')})
      .setColor(0x00ff00)
      .setFooter({ text: Last updated at ${new Date().toLocaleString()} });
    
    await interaction.message.edit({ embeds: [embed] });
    
    await interaction.editReply({ content: ✅ Approved ${interaction.values.length} request(s) });
  } catch (error) {
    console.error('Select menu interaction error:', error);
    await interaction.editReply({ content: '❌ An error occurred', ephemeral: true });
  }
}

// Server status monitoring
client.once('ready', async () => {
  console.log(✅ Logged in as ${client.user.tag});
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
        const msg = 👥 Player Count Changed: ${lastOnlineCount} → ${onlineCount};
        if (logChannel?.isTextBased()) await logChannel.send(msg);
        lastOnlineCount = onlineCount;
      }
    } catch (err) {
      console.error('❌ Polling error:', err);
    }
  }, 30000);
});

client.login(DISCORD_BOT_TOKEN);

 

 
