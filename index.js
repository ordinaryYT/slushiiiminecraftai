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
const LOG_CHANNEL_ID = '1377938133341180016';

const db = new Pool({ connectionString: DATABASE_URL });
let lastGrassMessageId = null;

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
  await db.query(`
    CREATE TABLE IF NOT EXISTS grass_stats (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      total_grass BIGINT DEFAULT 0,
      last_touch TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

async function postOrUpdateGrassMessage(channel) {
  const stats = await db.query('SELECT SUM(total_grass) as total, COUNT(*) as users FROM grass_stats');
  const total = stats.rows[0]?.total || 0;
  const users = stats.rows[0]?.users || 0;

  const voiceChannels = client.guilds.cache.get(GUILD_ID)?.channels.cache.filter(c => c.type === 2);
  const activeUsers = [...voiceChannels.values()].reduce((sum, ch) => sum + ch.members.filter(m => !m.user.bot).size, 0);

  const embed = new EmbedBuilder()
    .setDescription(
      `🌿 **${Number(total).toLocaleString()}** grass touched by **${users.toLocaleString()}** people.\n\n` +
      `*Last <t:${Math.floor(Date.now() / 1000)}:R>*.\n\n` +
      `🔊 There are currently **${activeUsers}** people in voice channel, come with them to touch grass automatically!`
    )
    .setColor(0x57F287)
    .setFooter({ text: 'There is new things comming soon 😄!' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('manual_grass').setStyle(ButtonStyle.Success).setEmoji('🌱').setLabel('Touch grass'),
    new ButtonBuilder().setCustomId('show_leaderboard').setStyle(ButtonStyle.Primary).setEmoji('📊').setLabel('Get LeaderBoard')
  );

  try {
    if (lastGrassMessageId) {
      const existingMessage = await channel.messages.fetch(lastGrassMessageId);
      await existingMessage.edit({ embeds: [embed], components: [row] });
    } else {
      const sent = await channel.send({ embeds: [embed], components: [row] });
      lastGrassMessageId = sent.id;
    }
  } catch (err) {
    console.error('❌ Could not update or send message:', err);
    const sent = await channel.send({ embeds: [embed], components: [row] });
    lastGrassMessageId = sent.id;
  }
}

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
    await db.query(`INSERT INTO cords (user_id, name, x, y, z, description, visibility)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user.id, name, x, y, z, description, visibility]);
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
        fields: ['online','host','port','version','players','gamemode','edition','software','plugins','motd'].map(f => ({
          name: f,
          value: String(data[f] || 'N/A'),
          inline: true
        }))
      };
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Failed to fetch server info.');
    }
  }

  if (commandName === 'grassleaderboard') {
    const res = await db.query(`SELECT username, total_grass FROM grass_stats ORDER BY total_grass DESC LIMIT 10`);
    const leaderboard = res.rows.map((r, i) => `#${i + 1} — **${r.username}**: ${r.total_grass} 🌿`).join('\n');
    return interaction.reply({ content: leaderboard });
  }
});

const voiceStates = new Map();
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.id;
  const member = newState.member;
  if (!member || member.user.bot) return;

  const joined = newState.channelId && !oldState.channelId;
  const left = !newState.channelId && oldState.channelId;

  if (joined) {
    voiceStates.set(userId, {
      joinedAt: Date.now(),
      muted: member.voice.selfMute,
      deafened: member.voice.selfDeaf
    });
  }

  if (left) {
    const session = voiceStates.get(userId);
    if (session) {
      const duration = (Date.now() - session.joinedAt) / 1000;
      if (duration >= 30) {
        const multiplier = (!session.muted && !session.deafened) ? 2 : 1;
        const grass = Math.floor(duration * multiplier);
        await db.query(`
          INSERT INTO grass_stats (user_id, username, total_grass)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id)
          DO UPDATE SET total_grass = grass_stats.total_grass + EXCLUDED.total_grass, last_touch = NOW();
        `, [userId, member.user.username, grass]);
      }
      voiceStates.delete(userId);
    }
  }
});

const serverInfoFields = ['online','host','port','version','players','gamemode','edition','software','plugins','motd'];

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
  new SlashCommandBuilder().setName('serverinfo').setDescription('Get Minecraft server info'),
  new SlashCommandBuilder().setName('grassleaderboard').setDescription('Show the top grass touchers')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();

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

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const grassChannel = await client.channels.fetch(GRASS_CHANNEL_ID);
  await postOrUpdateGrassMessage(grassChannel);
  setInterval(() => postOrUpdateGrassMessage(grassChannel), 60000);
});

client.login(DISCORD_BOT_TOKEN);
