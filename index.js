// index.js with SQLite-based coordinate storage
require('dotenv').config();
const axios = require('axios');
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`\u{1F310} Web server running on port ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// SQLite DB Setup
const db = new Database('cords.db');
db.exec(`CREATE TABLE IF NOT EXISTS cords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    name TEXT,
    x INTEGER,
    y INTEGER,
    z INTEGER,
    description TEXT,
    visibility TEXT,
    savedAt TEXT
);`);

// Register Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Get a random AI-generated joke'),

    new SlashCommandBuilder()
        .setName('savecords')
        .setDescription('Save coordinates')
        .addStringOption(opt => opt.setName('name').setDescription('Name').setRequired(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('X coord').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Y coord').setRequired(true))
        .addIntegerOption(opt => opt.setName('z').setDescription('Z coord').setRequired(true))
        .addStringOption(opt => opt.setName('visibility').setDescription('Public or Private').setRequired(true)
            .addChoices({ name: 'Public', value: 'public' }, { name: 'Private', value: 'private' }))
        .addStringOption(opt => opt.setName('description').setDescription('Optional description')), 

    new SlashCommandBuilder()
        .setName('publiccords')
        .setDescription('List all public coordinates'),

    new SlashCommandBuilder()
        .setName('privatecords')
        .setDescription('List your private coordinates')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
(async () => {
    try {
        console.log('Registering slash commands...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('Slash commands registered.');
    } catch (err) {
        console.error('Command registration failed:', err);
    }
})();

async function getAIResponse(prompt) {
    try {
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: MODEL,
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });
        return res.data.choices[0].message.content;
    } catch (err) {
        console.error("OpenRouter Error:", err.response?.data || err.message);
        return "❌ Error contacting AI.";
    }
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user } = interaction;

    if (commandName === 'joke') {
        await interaction.deferReply();
        const joke = await getAIResponse("Tell me a funny, original joke.");
        return interaction.editReply(joke);
    }

    if (commandName === 'savecords') {
        const stmt = db.prepare(`INSERT INTO cords (user, name, x, y, z, description, visibility, savedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
        stmt.run(
            user.id,
            options.getString('name'),
            options.getInteger('x'),
            options.getInteger('y'),
            options.getInteger('z'),
            options.getString('description') || 'No description',
            options.getString('visibility')
        );
        return interaction.reply(`✅ Saved coordinates for **${options.getString('name')}** as **${options.getString('visibility')}**.`);
    }

    if (commandName === 'publiccords') {
        const rows = db.prepare("SELECT * FROM cords WHERE visibility = 'public'").all();
        if (!rows.length) return interaction.reply("📭 No public coordinates saved.");
        const formatted = rows.map(r => `📍 **${r.name}** - (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
        return interaction.reply({ content: `🌍 Public Coordinates:\n\n${formatted}`, ephemeral: false });
    }

    if (commandName === 'privatecords') {
        const rows = db.prepare("SELECT * FROM cords WHERE visibility = 'private' AND user = ?").all(user.id);
        if (!rows.length) return interaction.reply({ content: "📭 You have no private coordinates.", ephemeral: true });
        const formatted = rows.map(r => `📍 **${r.name}** - (${r.x}, ${r.y}, ${r.z})\n📝 ${r.description}`).join('\n\n');
        return interaction.reply({ content: `🔒 Your Private Coordinates:\n\n${formatted}`, ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.content.startsWith("!ask")) {
        const question = message.content.slice(5).trim();
        if (!question) return message.reply("❌ Ask something after `!ask`");
        const reply = await getAIResponse(question);
        message.reply(reply);
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
