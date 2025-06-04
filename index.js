require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const {
  DISCORD_BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DATABASE_URL,
  HUGGINGFACE_TOKEN
} = process.env;

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
  new SlashCommandBuilder().setName('genimage').setDescription('Generate an image from a prompt')
    .addStringOption(o => o.setName('prompt').setDescription('Describe your image').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  await initDb();
})();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName, options, user } = interaction;

    if (commandName === 'genimage') {
      await interaction.deferReply();
      const prompt = options.getString('prompt');

      try {
        const response = await axios.post(
          'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2',
          { inputs: prompt },
          {
            headers: {
              Authorization: `Bearer ${HUGGINGFACE_TOKEN}`,
              Accept: 'application/json'
            },
            responseType: 'arraybuffer'
          }
        );

        const contentType = response.headers['content-type'];

        if (contentType.includes('application/json')) {
          const jsonResponse = JSON.parse(Buffer.from(response.data).toString('utf8'));
          if (jsonResponse.error && jsonResponse.error.includes('loading')) {
            return interaction.editReply('⏳ The model is currently loading. Please try again in a few moments.');
          } else {
            return interaction.editReply(`❌ Error: ${jsonResponse.error || 'Unknown error occurred.'}`);
          }
        }

        const imageBuffer = Buffer.from(response.data, 'binary');
        return interaction.editReply({
          content: `🖼️ Image generated for: "${prompt}"`,
          files: [{ attachment: imageBuffer, name: 'image.png' }]
        });
      } catch (apiError) {
        console.error('Error generating image:', apiError);
        return interaction.editReply('❌ Failed to generate image. Please try again later.');
      }
    }

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
      if (!res.rows.length) return interaction.reply('📭 No player records.');
      const list = res.rows.map(r => `👤 ${r.name} - ${new Date(r.first_seen).toLocaleDateString()}`).join('\n');
      return interaction.reply({ content: list });
    }

    if (commandName === 'serverinfo') {
      await interaction.deferReply();
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
    }

  } catch (err) {
    console.error('❌ Interaction error:', err);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply('❌ Something went wrong.');
    } else {
      interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
