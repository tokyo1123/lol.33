require('dotenv').config();

const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.send(`<h1 style="color:white;background:#222;padding:10px">TOKyodot Bot Control & Logs</h1>
  <div id="logs" style="height:400px;overflow:auto;border:1px solid #ccc;padding:5px;background:#111;color:#eee"></div>
  <input id="msg" placeholder="Type a message..." style="width:80%;padding:5px;margin-top:5px">
  <button onclick="sendMessage()" style="padding:5px">Send</button>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const logs = document.getElementById('logs');
    const msgInput = document.getElementById('msg');
    socket.on('log', msg => {
      logs.innerHTML += msg + '<br>';
      logs.scrollTop = logs.scrollHeight;
    });
    function sendMessage() {
      const msg = msgInput.value;
      if(msg.trim() !== "") {
        socket.emit('sendMessage', msg);
        msgInput.value = "";
      }
    }
  </script>`);
});
server.listen(3000, () => console.log('🌐 Web server running on port 3000'));

const discordToken = process.env.DISCORD_TOKEN;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

// HuggingFace AI Config
const HF_API_URL = "https://api-inference.huggingface.co/models/google/flan-t5-base";
const HF_API_KEY = process.env.HF_API_KEY || null;

async function askAI(question) {
  try {
    const response = await axios.post(
      HF_API_URL,
      { inputs: question },
      {
        headers: HF_API_KEY
          ? { Authorization: `Bearer ${HF_API_KEY}` }
          : {},
      }
    );
    if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].generated_text) {
      return response.data[0].generated_text.trim();
    }
    if (typeof response.data === "string") {
      return response.data.trim();
    }
    if (response.data && response.data.generated_text) {
      return response.data.generated_text.trim();
    }
    return "I couldn't think of an answer.";
  } catch (err) {
    console.error("AI Error:", err.message);
    return "Error fetching AI response.";
  }
}

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

let bot = null;
let autoMessageInterval = null;
let autoMoveInterval = null;
let sendMinecraftToDiscord = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function walkForwardBackward() {
  if (!bot || !bot.entity) return;
  bot.setControlState('forward', true);
  await sleep(15000);
  bot.setControlState('forward', false);
  bot.setControlState('back', true);
  await sleep(15000);
  bot.setControlState('back', false);
}

function logMsg(msg) {
  console.log(msg);
  io.emit('log', msg);
}

function createBot() {
  bot = mineflayer.createBot({
    host: 'TokyoServer.aternos.me',
    port: 43234,
    username: 'TOKyodot',
    connectTimeout: 60000,
    keepAlive: true,
  });

  bot.once('login', () => {
    logMsg(`✅ Logged in as ${bot.username}`);

    if (!autoMessageInterval) {
      autoMessageInterval = setInterval(() => {
        if (bot && bot.chat) {
          bot.chat('Welcome to Tokyo dz server — join our Discord: https://discord.gg/E4XpZeywAJ');
          logMsg('📢 Auto-message sent.');
        }
      }, 15 * 60 * 1000);
    }

    if (!autoMoveInterval) {
      autoMoveInterval = setInterval(() => {
        walkForwardBackward();
      }, 30000);
    }
  });

  bot.on('end', () => {
    logMsg('⚠️ Bot disconnected, reconnecting...');

    if (autoMessageInterval) {
      clearInterval(autoMessageInterval);
      autoMessageInterval = null;
    }
    if (autoMoveInterval) {
      clearInterval(autoMoveInterval);
      autoMoveInterval = null;
    }

    setTimeout(createBot, 5000);
  });

  bot.on('error', (err) => logMsg(`❌ Error: ${err}`));

  bot.on('chat', (username, message) => {
    logMsg(`<${username}> ${message}`);

    // AI command from Minecraft
    if (message.startsWith('!ask ')) {
      const question = message.slice(5).trim();
      if (!question) return bot.chat("Please provide a question.");
      bot.chat("💭 Thinking...");
      askAI(question).then(answer => {
        bot.chat(`🤖 ${answer}`);
      });
    }

    // Send to Discord if enabled
    if (sendMinecraftToDiscord && discordClient.isReady()) {
      const channel = discordClient.channels.cache.get(discordChannelId);
      if (channel) {
        channel.send(`**[Minecraft]** <${username}> ${message}`);
      }
    }
  });
}

io.on('connection', (socket) => {
  logMsg('🌐 Web client connected');
  socket.on('sendMessage', (msg) => {
    if (bot && bot.chat) {
      bot.chat(msg);
      logMsg(`💬 [WEB] ${msg}`);
    }
  });
});

discordClient.on('ready', () => {
  console.log(`Discord Bot logged in as ${discordClient.user.tag}`);
});

// Website check every 5 minutes
let lastWebsiteStatus = 'Unknown';
async function checkWebsite() {
  try {
    await axios.get('https://lol-33.onrender.com/');
    lastWebsiteStatus = '✅ Online';
  } catch (err) {
    lastWebsiteStatus = '❌ Offline';
  }
}
setInterval(checkWebsite, 5 * 60 * 1000);
checkWebsite();

discordClient.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== discordChannelId) return;

  const content = message.content.trim();

  if (content === '/start') {
    if (bot) {
      message.channel.send('Minecraft bot is already running.');
    } else {
      createBot();
      message.channel.send('Minecraft bot started.');
    }
  } else if (content === '/stop') {
    if (bot) {
      bot.quit('Stopped via Discord.');
      bot = null;
      if (autoMessageInterval) clearInterval(autoMessageInterval);
      if (autoMoveInterval) clearInterval(autoMoveInterval);
      message.channel.send('Minecraft bot stopped.');
    } else {
      message.channel.send('Minecraft bot is not running.');
    }
  } else if (content === '/rs') {
    if (bot) {
      bot.quit('Restarting...');
      bot = null;
      if (autoMessageInterval) clearInterval(autoMessageInterval);
      if (autoMoveInterval) clearInterval(autoMoveInterval);
      setTimeout(() => {
        createBot();
        message.channel.send('Minecraft bot restarted.');
      }, 3000);
    } else {
      message.channel.send('Minecraft bot is not running.');
    }
  } else if (content === '/pn') {
    sendMinecraftToDiscord = !sendMinecraftToDiscord;
    message.channel.send(sendMinecraftToDiscord ? '📩 Minecraft messages will be sent here.' : '🚫 Minecraft messages disabled.');
  } else if (content === '/ping') {
    message.channel.send(`📊 **System Status**:
- Discord Bot: ${discordClient.isReady() ? '✅ Online' : '❌ Offline'}
- Minecraft Bot: ${bot ? '✅ Connected' : '❌ Disconnected'}
- Website: ${lastWebsiteStatus}`);
  } else if (content.startsWith('/ask ')) {
    const question = content.slice(5).trim();
    if (!question) return message.reply("Please provide a question.");
    message.channel.send("💭 Thinking...");
    const answer = await askAI(question);
    message.channel.send(`🤖 ${answer}`);
  } else {
    if (bot && bot.chat) {
      bot.chat(content);
      message.react('✅');
    }
  }
});

discordClient.login(discordToken);
