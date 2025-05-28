// index.js with PostgreSQL coordinate storage for Render
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');

// Express Keep-Alive
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(process.env.PORT || 3000);

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL client
const db = new Pool({ connectionString: DATABASE_URL });

// Create table if it doesn't exist
const initDb = async () => {
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

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('joke')
    .setDescription('Get a random AI-generated joke'),

  new SlashCommandBuilder()
    .setName('savecords')
    .setDescription('Save coordinates')
    .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
    .addIntegerOption(o => o.setName('x').setDescription('X coord').setRequired(true))
    .addIntegerOption(o => o.setName('y').setDescription('Y coord').setRequired(true))
    .addIntegerOption(o => o.setName('z').setDescription('Z coord').setRequired(true))
    .addStringOption(o => o.setName('visibility').setDescription('public or private').setRequired(true).addChoices(
      { name: 'Public', value: 'public' },
      { name: 'Private', value: 'private' }
    ))
    .addStringOption(o => o.setName('description').setDescription('Optional description')),

  new SlashCommandBuilder()
    .setName('publiccords')
    .setDescription('List all public coordinates'),

  new SlashCommandBuilder()
    .setName('privatecords')
    .setDescription('List your private coordinates')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

// OpenRouter AI
async function getAIResponse(prompt) {
  try {
    const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error('AI error:', e);
    return '❌ AI failed.';
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, options } = interaction;

  if (commandName === 'joke') {
    await interaction.deferReply();
    const joke = await getAIResponse('Tell me a funny, original joke.');
    return interaction.editReply(joke);
  }

  if (commandName === 'savecords') {
    const { id } = user;
    const name = options.getString('name');
    const x = options.getInteger('x');
    const y = options.getInteger('y');
    const z = options.getInteger('z');
    const description = options.getString('description') || 'No description';
    const visibility = options.getString('visibility');

    await db.query(`INSERT INTO cords (user_id, name, x, y, z, description, visibility)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [id, name, x, y, z, description, visibility]);

    return interaction.reply(`✅ Saved **${name}** as **${visibility}**.`);
  }

  if (commandName === 'publiccords') {
    const res = await db.query("SELECT * FROM cords WHERE visibility = 'public' ORDER BY created_at DESC");
    if (!res.rows.length) return interaction.reply('📭 No public cords.');

    const text = res.rows.map(r => `📍 **${r.name}** (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.reply({ content: text, ephemeral: false });
  }

  if (commandName === 'privatecords') {
    const res = await db.query("SELECT * FROM cords WHERE user_id = $1 AND visibility = 'private' ORDER BY created_at DESC", [user.id]);
    if (!res.rows.length) return interaction.reply({ content: '📭 No private cords found.', ephemeral: true });

    const text = res.rows.map(r => `📍 **${r.name}** (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
    return interaction.reply({ content: text, ephemeral: true });
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content.startsWith('!ask')) {
    const prompt = message.content.slice(5).trim();
    if (!prompt) return message.reply('❌ Ask something after `!ask`');
    const reply = await getAIResponse(prompt);
    message.reply(reply);
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
