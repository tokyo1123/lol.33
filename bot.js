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
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>TOKyodot Bot Control</title>
      <style>
        /* ... هنا نفس ستايل الصفحة كما في كودك ... */
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>TOKyodot Bot Control Panel</h1>
          <div class="status" id="connection-status">Loading...</div>
        </header>
        <div class="panel">
          <div class="log-container">
            <div class="logs" id="logs"></div>
            <div class="input-group">
              <input type="text" id="msg" placeholder="Type a message to send in Minecraft..." autocomplete="off" />
              <button id="send-btn">Send</button>
            </div>
          </div>
          <div class="controls">
            <div class="control-title">Bot Controls</div>
            <div class="control-buttons">
              <button class="control-btn start-btn" id="start-btn">Start Bot</button>
              <button class="control-btn stop-btn" id="stop-btn">Stop Bot</button>
              <button class="control-btn restart-btn" id="restart-btn">Restart Bot</button>
            </div>
          </div>
        </div>
      </div>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const logs = document.getElementById('logs');
        const msgInput = document.getElementById('msg');
        const sendBtn = document.getElementById('send-btn');
        const statusElement = document.getElementById('connection-status');
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const restartBtn = document.getElementById('restart-btn');

        function getTimestamp() {
          const now = new Date();
          return now.toTimeString().split(' ')[0];
        }

        function addLog(msg, type = 'system') {
          const logEntry = document.createElement('div');
          logEntry.className = 'log-entry ' + type;
          logEntry.innerHTML = '<span class="timestamp">' + getTimestamp() + '</span>' + msg;
          logs.appendChild(logEntry);
          logs.scrollTop = logs.scrollHeight;
        }

        socket.on('log', (data) => addLog(data.message, data.type || 'system'));
        socket.on('status', (status) => {
          statusElement.textContent = status.text;
          statusElement.className = 'status ' + (status.online ? 'online' : 'offline');
        });

        function sendMessage() {
          const msg = msgInput.value.trim();
          if (msg) {
            socket.emit('sendMessage', msg);
            addLog('[You] ' + msg, 'chat');
            msgInput.value = '';
          }
        }

        sendBtn.addEventListener('click', sendMessage);
        msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

        startBtn.addEventListener('click', () => socket.emit('control', 'start'));
        stopBtn.addEventListener('click', () => socket.emit('control', 'stop'));
        restartBtn.addEventListener('click', () => socket.emit('control', 'restart'));

        socket.emit('getStatus');
      </script>
    </body>
    </html>
  `);
});

server.listen(3000, () => console.log('🌐 Web server running on port 3000'));

const discordToken = process.env.DISCORD_TOKEN;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
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

function logMsg(msg, type = 'system') {
  console.log(msg);
  io.emit('log', { message: msg, type });

  const isOnline = bot !== null;
  io.emit('status', {
    text: isOnline ? 'Online' : 'Offline',
    online: isOnline
  });
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
    logMsg('⚠️ Bot disconnected, reconnecting...', 'error');

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

  bot.on('error', (err) => logMsg(`❌ Error: ${err}`, 'error'));

  bot.on('chat', (username, message) => {
    logMsg(`<${username}> ${message}`, 'chat');

    // هنا لم يعد هناك AI ولا رد تلقائي

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

  socket.emit('status', {
    text: bot ? 'Online' : 'Offline',
    online: bot !== null
  });

  socket.on('sendMessage', (msg) => {
    if (bot && bot.chat) {
      bot.chat(msg);
      logMsg(`💬 [WEB] ${msg}`, 'chat');
    }
  });

  socket.on('control', (action) => {
    switch (action) {
      case 'start':
        if (!bot) {
          createBot();
          logMsg('🔄 Bot started by web interface');
        }
        break;
      case 'stop':
        if (bot) {
          bot.quit('Stopped via web interface');
          bot = null;
          if (autoMessageInterval) clearInterval(autoMessageInterval);
          if (autoMoveInterval) clearInterval(autoMoveInterval);
          logMsg('🛑 Bot stopped by web interface');
        }
        break;
      case 'restart':
        if (bot) {
          bot.quit('Restarting via web interface');
          bot = null;
          if (autoMessageInterval) clearInterval(autoMessageInterval);
          if (autoMoveInterval) clearInterval(autoMoveInterval);
          setTimeout(createBot, 3000);
          logMsg('🔄 Bot restarting...');
        }
        break;
    }
  });

  socket.on('getStatus', () => {
    socket.emit('status', {
      text: bot ? 'Online' : 'Offline',
      online: bot !== null
    });
  });
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

discordClient.on('ready', () => {
  console.log(`Discord Bot logged in as ${discordClient.user.tag}`);
});

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
  } else {
    // يرسل رسالة مباشرة في الماينكرافت
    if (bot && bot.chat) {
      bot.chat(content);
      message.react('✅');
    }
  }
});

discordClient.login(discordToken);
