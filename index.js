require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
    GatewayIntentBits.GuildVoiceStates
  ]
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GRASS_CHANNEL_ID = process.env.GRASS_CHANNEL_ID;

const db = new Pool({ connectionString: DATABASE_URL });
const voiceStates = new Map();

const initDb = async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS grass_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    total_grass BIGINT DEFAULT 0,
    last_touch TIMESTAMPTZ DEFAULT NOW()
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS joined_players (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE,
    first_seen TIMESTAMPTZ DEFAULT NOW()
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS cords (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    x INT,
    y INT,
    z INT,
    description TEXT,
    visibility TEXT CHECK (visibility IN ('public', 'private')),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
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
  new SlashCommandBuilder().setName('grassleaderboard').setDescription('Show the top grass touchers')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const grassChannel = await client.channels.fetch(GRASS_CHANNEL_ID);
  postGrassMessage(grassChannel);
  setInterval(() => postGrassMessage(grassChannel), 60000);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.id;
  const member = newState.member;
  if (!member || member.user.bot) return;

  const joined = newState.channelId && !oldState.channelId;
  const left = !newState.channelId && oldState.channelId;

  if (joined) {
    voiceStates.set(userId, { joinedAt: Date.now(), muted: member.voice.selfMute, deafened: member.voice.selfDeaf });
  }

  if (left && voiceStates.has(userId)) {
    const session = voiceStates.get(userId);
    const duration = (Date.now() - session.joinedAt) / 1000;
    if (duration >= 30) {
      const multiplier = (!session.muted && !session.deafened) ? 2 : 1;
      const grass = Math.floor(duration * multiplier);
      await db.query(`
        INSERT INTO grass_stats (user_id, username, total_grass)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id)
        DO UPDATE SET total_grass = grass_stats.total_grass + EXCLUDED.total_grass, last_touch = NOW()
      `, [userId, member.user.username, grass]);
    }
    voiceStates.delete(userId);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const { customId, user } = interaction;
    if (customId === 'manual_grass') {
      await db.query(`
        INSERT INTO grass_stats (user_id, username, total_grass)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id)
        DO UPDATE SET total_grass = grass_stats.total_grass + 1, last_touch = NOW()
      `, [user.id, user.username]);
      return interaction.reply({ content: '🌱 You touched grass!', ephemeral: true });
    }
    if (customId === 'show_leaderboard') {
      const res = await db.query(`SELECT username, total_grass FROM grass_stats ORDER BY total_grass DESC LIMIT 10`);
      const leaderboard = res.rows.map((r, i) => `#${i + 1} — **${r.username}**: ${r.total_grass} 🌿`).join('\n');
      return interaction.reply({ content: `🏆 **Grass Leaderboard**:\n${leaderboard}`, ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options } = interaction;
  // Add your existing slash command handling from earlier here (savecords, etc.)
});

async function postGrassMessage(channel) {
  const stats = await db.query('SELECT SUM(total_grass) as total, COUNT(*) as users FROM grass_stats');
  const total = stats.rows[0]?.total || 0;
  const users = stats.rows[0]?.users || 0;

  const voiceChannels = client.guilds.cache.get(GUILD_ID)?.channels.cache.filter(c => c.type === 2);
  const activeUsers = [...voiceChannels.values()].reduce((sum, ch) => sum + ch.members.filter(m => !m.user.bot).size, 0);

  const embed = new EmbedBuilder()
    .setDescription(`🌿 **${Number(total).toLocaleString()}** grass touched by **${users.toLocaleString()}** people.\n\n*Last <t:${Math.floor(Date.now() / 1000)}:R>*\n\n🔊 There are currently **${activeUsers}** people in voice channel, come with them to touch grass automatically!`)
    .setColor(0x57F287)
    .setFooter({ text: 'There’s so much new things that will coming! Stay tuned !' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('manual_grass').setStyle(ButtonStyle.Success).setEmoji('🌱').setLabel('Touch grass'),
    new ButtonBuilder().setCustomId('show_leaderboard').setStyle(ButtonStyle.Primary).setEmoji('📊').setLabel('Get LeaderBoard')
  );

  await channel.send({ embeds: [embed], components: [row] });
}

client.login(DISCORD_BOT_TOKEN);
