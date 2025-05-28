require('dotenv').config();
const axios = require('axios');
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Optional web server just to keep the app alive
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// --- Discord Bot setup ---
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

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
});

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
    const serverKeywords = ['minecraft', 'server', 'ip', 'address', 'join'];
    const mentionsServer = serverKeywords.some(keyword => content.includes(keyword));

    if (mentionsServer) {
        message.channel.send(
            `⬇️ **SlxshyNationCraft Community Server info!** ⬇️\n` +
            `**Server Name:** SlxshyNationCraft\n` +
            `**Server Address:** 87.106.101.66\n` +
            `**Server Port:** 6367`
        );
        return;
    }

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

client.login(DISCORD_BOT_TOKEN);
