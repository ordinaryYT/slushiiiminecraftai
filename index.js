require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
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
    console.log(`🌐 Web server running on port ${PORT}`);
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

// --- Coordinate Storage ---
const CORDS_FILE = path.join(__dirname, 'cords.json');
let savedCords = { public: [], private: {} };

if (fs.existsSync(CORDS_FILE)) {
    savedCords = JSON.parse(fs.readFileSync(CORDS_FILE, 'utf-8'));
} else {
    fs.writeFileSync(CORDS_FILE, JSON.stringify(savedCords, null, 2));
}

function saveCordsToFile() {
    fs.writeFileSync(CORDS_FILE, JSON.stringify(savedCords, null, 2));
}

// --- Slash Commands ---
const commands = [
    new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Get a random AI-generated joke'),

    new SlashCommandBuilder()
        .setName('savecords')
        .setDescription('Save coordinates with a name and visibility')
        .addStringOption(opt => opt.setName('name').setDescription('Name of the location').setRequired(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('X coordinate').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Y coordinate').setRequired(true))
        .addIntegerOption(opt => opt.setName('z').setDescription('Z coordinate').setRequired(true))
        .addStringOption(opt =>
            opt.setName('visibility')
                .setDescription('Public or Private?')
                .setRequired(true)
                .addChoices(
                    { name: 'Public', value: 'public' },
                    { name: 'Private', value: 'private' }
                )
        )
        .addStringOption(opt => opt.setName('description').setDescription('What is at this location?')),

    new SlashCommandBuilder()
        .setName('publiccords')
        .setDescription('List all public Minecraft coordinates'),

    new SlashCommandBuilder()
        .setName('privatecords')
        .setDescription('List your saved private coordinates')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('🔁 Registering slash commands for guild...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
})();

// --- AI Function ---
async function getAIResponse(userQuestion) {
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: MODEL,
                messages: [{ role: "user", content: userQuestion }]
            },
            {
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("❌ OpenRouter API Error:", error.response ? error.response.data : error.message);
        return "❌ Error processing request.";
    }
}

// --- Slash Command Handling ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, options } = interaction;

    if (commandName === 'joke') {
        await interaction.deferReply();
        const joke = await getAIResponse("Tell me a funny, original joke.");
        await interaction.editReply(joke);
    }

    if (commandName === 'savecords') {
        const name = options.getString('name');
        const x = options.getInteger('x');
        const y = options.getInteger('y');
        const z = options.getInteger('z');
        const description = options.getString('description') || 'No description';
        const visibility = options.getString('visibility');

        const entry = {
            name,
            x,
            y,
            z,
            description,
            savedBy: user.id,
            savedAt: new Date().toISOString()
        };

        if (visibility === 'public') {
            savedCords.public.push(entry);
        } else {
            if (!savedCords.private[user.id]) savedCords.private[user.id] = [];
            savedCords.private[user.id].push(entry);
        }

        saveCordsToFile();
        await interaction.reply(`✅ Coordinates for **${name}** saved as **${visibility}**.`);
    }

    if (commandName === 'publiccords') {
        if (savedCords.public.length === 0) {
            await interaction.reply("📭 No public coordinates saved yet.");
            return;
        }

        const list = savedCords.public.map(c =>
            `📍 **${c.name}** - (${c.x}, ${c.y}, ${c.z})\n📝 ${c.description}`
        ).join('\n\n');

        await interaction.reply({ content: `🌍 **Public Coordinates:**\n\n${list}`, ephemeral: false });
    }

    if (commandName === 'privatecords') {
        const userCords = savedCords.private[user.id];
        if (!userCords || userCords.length === 0) {
            await interaction.reply({ content: "📭 You have no private coordinates saved.", ephemeral: true });
            return;
        }

        const list = userCords.map(c =>
            `📍 **${c.name}** - (${c.x}, ${c.y}, ${c.z})\n📝 ${c.description}`
        ).join('\n\n');

        await interaction.reply({ content: `🔒 **Your Private Coordinates:**\n\n${list}`, ephemeral: true });
    }
});

// --- Handle !ask messages ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();
    if (content.startsWith("!ask")) {
        const userQuestion = message.content.slice(5).trim();
        if (!userQuestion) {
            message.channel.send("❌ Please ask a question after `!ask`.");
            return;
        }

        const aiReply = await getAIResponse(userQuestion);
        message.channel.send(aiReply);
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(DISCORD_BOT_TOKEN);
