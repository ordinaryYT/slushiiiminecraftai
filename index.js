require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');

const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // needed for voice (music)
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

const serverInfoFields = [
  'online', 'host', 'port', 'version', 'players', 'gamemode',
  'edition', 'software', 'plugins', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'
];

// --- Define slash commands ---
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
  // Music commands:
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave voice channel and stop music'),
  new SlashCommandBuilder().setName('play').setDescription('Play a song from YouTube or URL')
    .addStringOption(o => o.setName('query').setDescription('Search term or URL').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the current music queue'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

// Initialize the music player
const player = new Player(client);
(async () => {
  await player.extractors.loadDefault();
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

  // Join replies with server info
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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options, member, guild } = interaction;

  // Coordinate commands
  if (commandName === 'savecords') {
    await interaction.deferReply({ ephemeral: true });
    const name = options.getString('name');
    const x = options.getInteger('x');
    const y = options.getInteger('y');
    const z = options.getInteger('z');
    const description = options.getString('description') || 'No description';
    const visibility = options.getString('visibility');
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
    if (!res.rows.length) return interaction.reply('📭 No player records found.');
    const list = res.rows.map(r => `🧑‍🚀 **${r.name}** joined at <t:${Math.floor(new Date(r.first_seen).getTime()/1000)}:f>`).join('\n');
    return interaction.reply(list);
  }

  if (commandName === 'serverinfo') {
    await interaction.deferReply();
    const filter = options.getString('filter');
    try {
      const { data } = await axios.get('https://mcstatus.io/api/v2/status/java/87.106.101.66:6367');
      const info = data?.players ? data : null;
      if (!info) return interaction.editReply('❌ Server info not available.');

      if (filter) {
        if (!(filter in info)) return interaction.editReply(`❌ No data for filter: ${filter}`);
        return interaction.editReply(`**${filter}**: ${JSON.stringify(info[filter], null, 2)}`);
      }

      // Show basic info embed
      const embed = new EmbedBuilder()
        .setTitle('Minecraft Server Info')
        .setDescription(`Status for SlxshyNationCraft`)
        .setColor(info.online ? 'Green' : 'Red')
        .addFields(
          { name: 'Online', value: String(info.online), inline: true },
          { name: 'Players Online', value: info.players?.online?.toString() || '0', inline: true },
          { name: 'Version', value: info.version?.name || 'Unknown', inline: true },
          { name: 'MOTD', value: info.motd?.clean || 'N/A' }
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply('❌ Failed to fetch server info.');
    }
  }

  // Music commands
  if (commandName === 'join') {
    if (!member.voice.channel) return interaction.reply('❌ You need to join a voice channel first!');
    try {
      const connection = await player.voiceUtils.joinVoiceChannel({
        channelId: member.voice.channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      return interaction.reply('✅ Joined your voice channel!');
    } catch (err) {
      console.error(err);
      return interaction.reply('❌ Failed to join your voice channel.');
    }
  }

  if (commandName === 'leave') {
    const queue = player.getQueue(guild.id);
    if (queue) queue.destroy();
    return interaction.reply('👋 Left the voice channel and stopped music.');
  }

  if (commandName === 'play') {
    if (!member.voice.channel) return interaction.reply('❌ You need to join a voice channel first!');
    const query = options.getString('query');

    let queue = player.getQueue(guild.id);
    if (!queue) {
      queue = player.createQueue(guild, {
        metadata: {
          channel: interaction.channel
        },
        leaveOnEmptyCooldown: 300000, // 5 minutes before leaving if empty
        leaveOnEnd: false, // do not leave after queue ends to keep 24/7 join until leave
      });
    }

    try {
      if (!queue.connection) await queue.connect(member.voice.channel);
      const track = await queue.play(query, { requestedBy: interaction.user });
      return interaction.reply(`🎶 Added **${track.title}** to the queue.`);
    } catch (error) {
      console.error(error);
      return interaction.reply('❌ Could not play the track.');
    }
  }

  if (commandName === 'skip') {
    const queue = player.getQueue(guild.id);
    if (!queue || !queue.playing) return interaction.reply('❌ No music is playing.');
    const currentTrack = queue.current;
    const success = queue.skip();
    return interaction.reply(success ? `⏭ Skipped **${currentTrack.title}**.` : '❌ Could not skip track.');
  }

  if (commandName === 'stop') {
    const queue = player.getQueue(guild.id);
    if (!queue) return interaction.reply('❌ No music queue to stop.');
    queue.destroy();
    return interaction.reply('⏹ Stopped playback and cleared the queue.');
  }

  if (commandName === 'queue') {
    const queue = player.getQueue(guild.id);
    if (!queue || !queue.tracks.length) return interaction.reply('📭 The queue is empty.');
    const current = queue.current;
    const tracks = queue.tracks.slice(0, 10).map((track, i) => `${i + 1}. ${track.title} — ${track.author}`);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Music Queue')
          .setDescription(`Now Playing:\n**${current.title}**\n\nUp Next:\n${tracks.join('\n')}`)
          .setColor('Blue')
      ]
    });
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
