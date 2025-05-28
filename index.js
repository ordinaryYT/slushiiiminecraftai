require('dotenv').config();
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

// Register slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Get a random AI-generated joke')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('🔁 Registering slash commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
})();

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
        return "❌ Error processing request. Check logs for details.";
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    // Trigger conditions
    const asksForServerInfo = (
        content.includes('how do i join') ||
        content.includes('server ip') ||
        content.includes('join server') ||
        content.includes('what is the server') ||
        (content.includes('server') && content.includes('address'))
    );

    const consoleKeywords = ['console', 'xbox', 'ps4', 'ps5', 'switch', 'phone', 'mobile', 'bedrocktogether', 'android', 'ios'];
    const javaKeywords = ['java', 'java edition', 'java minecraft'];

    const asksAboutConsole = consoleKeywords.some(keyword => content.includes(keyword)) && content.includes('join');
    const asksAboutJava = javaKeywords.some(keyword => content.includes(keyword)) && content.includes('join');

    // Respond with server info
    if (asksForServerInfo) {
        message.channel.send(
            `⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n` +
            `**Server Name:** SlxshyNationCraft\n` +
            `**Server Address:** 87.106.101.66\n` +
            `**Server Port:** 6367`
        );
        return;
    }

    // Respond to console/mobile join questions
    if (asksAboutConsole) {
        message.channel.send(
            `📱 **How to Join on Console (Xbox, PlayStation, Switch, Mobile)**:\n` +
            `If you are on console and want to join the server, download the **"BedrockTogether"** app on your phone.\n` +
            `Open the app, enter the server IP and port:\n` +
            `**IP:** 87.106.101.66\n**Port:** 6367\nClick "Run".\n` +
            `Then open Minecraft and go to the "Friends" tab (or "Worlds" tab in the new UI).\n` +
            `Join the server from the **LAN section**.\n` +
            `You can close the BedrockTogether app once connected.`
        );
        return;
    }

    // Respond to Java edition join attempts
    if (asksAboutJava) {
        message.channel.send(
            `💻 **Java Edition Notice**:\n` +
            `Unfortunately, the SlxshyNationCraft MC server is a **Bedrock-only** server 😢\n` +
            `There is currently no way for Java players to join it.\n` +
            `We’re sorry for the inconvenience!`
        );
        return;
    }

    // Handle !ask for AI queries
    if (content.startsWith("!ask")) {
        const userQuestion = message.content.slice(5).trim();
        if (!userQuestion) {
            message.channel.send("❌ Please ask a question after '!ask'.");
            return;
        }

        const aiReply = await getAIResponse(userQuestion);
        message.channel.send(aiReply);
    }
});

// Slash command: /joke
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'joke') {
        await interaction.deferReply();
        const jokePrompt = "Tell me a funny and original joke suitable for a general audience.";

        try {
            const joke = await getAIResponse(jokePrompt);
            await interaction.editReply(joke);
        } catch (error) {
            await interaction.editReply("❌ Couldn't get a joke right now. Try again later!");
        }
    }
});

client.login(DISCORD_BOT_TOKEN);
