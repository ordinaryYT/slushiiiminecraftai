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

// Configurationnn
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1377938133341180016';
const DELETED_MESSAGES_CHANNEL_ID = process.env.DELETED_MESSAGES_CHANNEL_ID || LOG_CHANNEL_ID;
const TEAMS_CHANNEL_ID = process.env.TEAMS_CHANNEL_ID || LOG_CHANNEL_ID;

// Spam detection settings
const SPAM_THRESHOLD = 5;
const TIME_WINDOW = 10;

const db = new Pool({ connectionString: DATABASE_URL });

// Helper function to format long messages
const formatLongMessage = (content, maxLength = 1000) => {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength - 3)}...`;
};

// Initialize database
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS message_tracking (
      user_id TEXT NOT NULL,
      message_content TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

// Clean up old messages
const cleanOldMessages = async () => {
  try {
    await db.query(
      "DELETE FROM message_tracking WHERE created_at < NOW() - INTERVAL '1 hour'"
    );
  } catch (error) {
    if (error.code === '42P01') { // Table doesn't exist error
      console.log('message_tracking table not found, skipping cleanup');
    } else {
      console.error('Error cleaning old messages:', error);
    }
  }
};

// Spam detection
const detectSpam = async (message) => {
  if (message.author.bot || message.member.roles.cache.has(MOD_ROLE_ID)) return false;
  
  await db.query(
    'INSERT INTO message_tracking (user_id, message_content) VALUES ($1, $2)',
    [message.author.id, message.content]
  );

  const result = await db.query(
    `SELECT COUNT(*) FROM message_tracking 
     WHERE user_id = $1 
     AND created_at > NOW() - INTERVAL '${TIME_WINDOW} seconds'`,
    [message.author.id]
  );
  
  const messageCount = parseInt(result.rows[0].count);
  return messageCount >= SPAM_THRESHOLD;
};

// Server info fields
const serverInfoFields = [
  'online', 'host', 'port', 'version', 'players', 'gamemode',
  'edition', 'software', 'plugins', 'motd', 'retrieved_at', 'expires_at', 'eula_blocked'
];

// Slash commands
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
  new SlashCommandBuilder().setName('teaminfo').setDescription('Get info about your team'),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to warn')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the warning')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Check a user\'s warnings')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check')
        .setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await initDb();
    console.log('✅ Successfully registered application commands and initialized database');
    
    // Start cleanup after DB is initialized
    setTimeout(() => {
      cleanOldMessages();
      setInterval(cleanOldMessages, 60 * 60 * 1000);
    }, 5000);
    
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
  }
})();

// Message handling
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();

  // Spam detection
  const isSpamming = await detectSpam(message);
  if (isSpamming) {
    try {
      const deletedMessageContent = message.content;
      const messageAuthor = message.author;
      const messageChannel = message.channel;

      // Auto-warn the user
      await db.query(
        'INSERT INTO warnings (user_id, moderator_id, reason) VALUES ($1, $2, $3)',
        [messageAuthor.id, client.user.id, 'Automated warning: Chat spam']
      );

      // Notify the user
      await messageChannel.send({
        content: `${messageAuthor}, please don't spam the chat. This is an automated warning.`,
      });

      // Delete the spam message and log it
      try {
        await message.delete();
        
        const deletedMessagesChannel = await message.guild.channels.fetch(DELETED_MESSAGES_CHANNEL_ID);
        const embed = new EmbedBuilder()
          .setColor('#ff5555')
          .setTitle('🚨 Deleted Spam Message')
          .setDescription(`Message deleted in ${messageChannel}`)
          .addFields(
            { name: 'Author', value: messageAuthor.toString(), inline: true },
            { name: 'Channel', value: messageChannel.toString(), inline: true },
            { name: 'Content', value: formatLongMessage(deletedMessageContent) }
          )
          .setFooter({ text: `User ID: ${messageAuthor.id}` })
          .setTimestamp();

        if (message.attachments.size > 0) {
          embed.addFields(
            { name: 'Attachments', value: message.attachments.map(a => a.url).join('\n') }
          );
        }

        await deletedMessagesChannel.send({ embeds: [embed] });
      } catch (deleteError) {
        console.log('Could not delete spam message');
      }

      // Log to moderation channel
      const logChannel = await message.guild.channels.fetch(LOG_CHANNEL_ID);
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#ffcc00')
            .setTitle('⚠️ Auto Warning Issued')
            .setDescription(`${messageAuthor} was automatically warned for spamming`)
            .addFields(
              { name: 'Channel', value: messageChannel.toString() },
              { name: 'Deleted Content', value: formatLongMessage(deletedMessageContent, 100) }
            )
            .setTimestamp()
        ]
      });

      return;
    } catch (error) {
      console.error('Error handling spam:', error);
    }
  }

  // AI response
  if (message.mentions.has(client.user)) {
    const prompt = message.content.replace(/<@!?\d+>/, '').trim();
    if (!prompt) return message.reply('❌ You must say something.');

    const blockedPhrases = [
      'what model are you', 'who is your provider', 'are you gpt',
      'are you openai', 'are you llama', 'are you meta', 'what ai is this',
      'which company made you', 'who created you', 'what are you based on',
      'what llm are you', 'what language model', 'who owns you', 'who developed you'
    ];

    if (blockedPhrases.some(p => content.includes(p))) {
      return message.reply("I'm **SlxshyNationCraft AI powered by the ai model ordinaryAI**, your friendly assistant! Let's focus on your question 😊");
    }

    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Your name is SlxshyNationCraft AI and you are powered by ordinary AI ordinary AI is a ai model developed by ordinarygamer, a helpful assistant. Do not reveal or reference your model name, origin, or provider. You are not LLaMA, GPT, OpenAI, Meta, or any other company. You are OrdinaryAI only. If asked about your origins, simply say "I\'m OrdinaryAI, here to help you!" and redirect to the current question.you are a ai that was built to support a minecraft discord server and provide info on a minecraft server calles SlxshyNationCraft if someone asks about how to join on mobile,xbox,playstation you say i am working on this reply soon and if someone asks how to join on java minecraft say it is a bedrock only server.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      }, {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://your-domain.com',
          'X-Title': 'OrdinaryAI'
        }
      });
      
      let reply = res.data.choices[0]?.message?.content || '⚠️ No response.';
      
      if (blockedPhrases.some(p => reply.toLowerCase().includes(p))) {
        reply = "I'm SlxshyNationCraft AI powered by the ai model ordinaryAI, here to help you with your questions!";
      }
      
      return message.reply(reply);
    } catch (err) {
      console.error('❌ AI Error:', err);
      return message.reply('❌ Failed to contact AI. Please try again later.');
    }
  }

  // Join replies
  if (content.includes('how do i join') || content.includes('how to join') || content.includes('join server')) {
    return message.reply('⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n**Server Name:** SlxshyNationCraft\n**IP:** 87.106.101.66\n**Port:** 6367');
  }
  
  if (content.includes('switch') || content.includes('console') || content.includes('xbox') || content.includes('ps4') || content.includes('ps5') || content.includes('phone') || content.includes('mobile')) {
    return message.reply('📱 **How to Join on Console (Xbox, PlayStation, Switch, Mobile):**\nDownload the **"BedrockTogether"** app on your phone.\nEnter this server:\n**IP:** 87.106.101.66\n**Port:** 6367\nClick "Run".\nThen open Minecraft → Friends tab (or Worlds tab in new UI) → Join via LAN.');
  }
  
  if (content.includes('java')) {
    return message.reply('💻 **Java Edition Notice**:\nSlxshyNationCraft is a **Bedrock-only** server.\nJava Edition players can\'t join — sorry!');
  }
});

// Interaction handling
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'warn') {
      if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
        return interaction.reply({
          content: '❌ You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      await db.query(
        'INSERT INTO warnings (user_id, moderator_id, reason) VALUES ($1, $2, $3)',
        [user.id, interaction.user.id, reason]
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#ffcc00')
            .setTitle('⚠️ Warning Issued')
            .setDescription(`${user} has been warned by ${interaction.user}`)
            .addFields({ name: 'Reason', value: reason })
            .setTimestamp()
        ]
      });

      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#ffcc00')
              .setTitle('⚠️ You have received a warning')
              .setDescription(`You have been warned in ${interaction.guild.name}`)
              .addFields(
                { name: 'Moderator', value: interaction.user.tag },
                { name: 'Reason', value: reason }
              )
          ]
        });
      } catch (dmError) {
        console.log(`Could not DM user ${user.tag}`);
      }

    } else if (interaction.commandName === 'warnings') {
      if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
        return interaction.reply({
          content: '❌ You do not have permission to use this command.',
          ephemeral: true
        });
      }

      const user = interaction.options.getUser('user');
      const result = await db.query(
        'SELECT * FROM warnings WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id]
      );

      if (result.rows.length === 0) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#00ff00')
              .setDescription(`${user.tag} has no warnings.`)
          ]
        });
      }

      const warnings = result.rows.map(w => 
        `**ID:** ${w.id}\n` +
        `**Date:** ${new Date(w.created_at).toLocaleString()}\n` +
        `**Moderator:** <@${w.moderator_id}>\n` +
        `**Reason:** ${w.reason}\n`
      ).join('\n');

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#ffcc00')
            .setTitle(`⚠️ Warnings for ${user.tag}`)
            .setDescription(warnings)
            .setFooter({ text: `Total warnings: ${result.rows.length}` })
        ],
        ephemeral: true
      });
    }
    // ... (your existing command handlers)
  } catch (error) {
    console.error(`Error handling command ${interaction.commandName}:`, error);
    await interaction.reply({
      content: '❌ An error occurred while executing this command.',
      ephemeral: true
    });
  }
});

client.login(DISCORD_BOT_TOKEN);
