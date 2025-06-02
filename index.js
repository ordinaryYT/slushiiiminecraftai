require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');

const { Player } = require('discord-player');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // needed for voice connections
  ],
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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

// Slash commands, including music commands
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

const player = new Player(client);

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options, member, guild } = interaction;

  // Coordinate commands here (like your original ones)...

  // Music commands:

  if (commandName === 'join') {
    if (!member.voice.channel) return interaction.reply('❌ You need to join a voice channel first!');
    if (!guild.voiceAdapterCreator) return interaction.reply('❌ Voice adapter not available.');

    try {
      await player.voiceUtils.joinVoiceChannel({
        channelId: member.voice.channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      return interaction.reply('✅ Joined your voice channel!');
    } catch (err) {
      console.error('Error joining voice channel:', err);
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
        metadata: { channel: interaction.channel },
        leaveOnEmptyCooldown: 300000,  // 5 minutes delay before leaving if empty
        leaveOnEnd: false,             // Don't leave when queue ends, for 24/7 mode
      });
    }

    try {
      if (!queue.connection) await queue.connect(member.voice.channel);
      const track = await queue.play(query, { requestedBy: interaction.user });
      return interaction.reply(`🎶 Added **${track.title}** to the queue.`);
    } catch (error) {
      console.error('Play error:', error);
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
