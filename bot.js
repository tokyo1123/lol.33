require('dotenv').config();

const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8" /><title>Bot Control</title></head>
    <body>
      <h1>Control Panel</h1>
      <button onclick="startBot()">Start Bot</button>
      <button onclick="stopBot()">Stop Bot</button>
      <button onclick="restartBot()">Restart Bot</button>
      <div id="logs" style="white-space: pre-wrap; background:#222; color:#eee; padding:10px; height:300px; overflow-y: scroll;"></div>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const logs = document.getElementById('logs');
        socket.on('log', data => {
          logs.textContent += data.message + "\\n";
          logs.scrollTop = logs.scrollHeight;
        });
        function startBot() { socket.emit('control', 'start'); }
        function stopBot() { socket.emit('control', 'stop'); }
        function restartBot() { socket.emit('control', 'restart'); }
      </script>
    </body>
    </html>
  `);
});

server.listen(3000, () => console.log('Web server running on port 3000'));

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

function logMsg(msg) {
  console.log(msg);
  io.emit('log', { message: msg });
}

function cleanUpBot() {
  if (autoMessageInterval) {
    clearInterval(autoMessageInterval);
    autoMessageInterval = null;
  }
  if (autoMoveInterval) {
    clearInterval(autoMoveInterval);
    autoMoveInterval = null;
  }
  bot = null;
}

function createBot() {
  if (bot) {
    logMsg('Bot is already running.');
    return;
  }
  bot = mineflayer.createBot({
    host: 'TokyoServer.aternos.me',
    port: 43234,
    username: 'TOKyodot',
    connectTimeout: 60000,
    keepAlive: true,
  });

  bot.once('login', () => {
    logMsg(`Logged in as ${bot.username}`);

    autoMessageInterval = setInterval(() => {
      if (bot && bot.chat) {
        bot.chat('Welcome to Tokyo dz server — join our Discord: https://discord.gg/E4XpZeywAJ');
        logMsg('Auto-message sent.');
      }
    }, 15 * 60 * 1000);

    autoMoveInterval = setInterval(() => {
      walkForwardBackward();
    }, 30000);
  });

  bot.on('end', () => {
    logMsg('Bot disconnected');
    cleanUpBot();
  });

  bot.on('error', err => logMsg(`Error: ${err}`));

  bot.on('chat', (username, message) => {
    logMsg(`<${username}> ${message}`);

    if (sendMinecraftToDiscord && discordClient.isReady()) {
      const channel = discordClient.channels.cache.get(discordChannelId);
      if (channel) {
        channel.send(`**[Minecraft]** <${username}> ${message}`);
      }
    }
  });
}

io.on('connection', socket => {
  logMsg('Web client connected');

  socket.on('control', action => {
    if (action === 'start') {
      createBot();
    } else if (action === 'stop') {
      if (bot) {
        bot.quit('Stopped via web');
        cleanUpBot();
      }
    } else if (action === 'restart') {
      if (bot) {
        bot.quit('Restarting via web');
        cleanUpBot();
        setTimeout(createBot, 3000);
      }
    }
  });
});

discordClient.on('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', message => {
  if (message.author.bot) return;
  if (message.channel.id !== discordChannelId) return;

  const content = message.content.trim();

  if (content === '/start') {
    if (!bot) {
      createBot();
      message.channel.send('Minecraft bot started.');
    } else {
      message.channel.send('Minecraft bot is already running.');
    }
  } else if (content === '/stop') {
    if (bot) {
      bot.quit('Stopped via Discord');
      cleanUpBot();
      message.channel.send('Minecraft bot stopped.');
    } else {
      message.channel.send('Minecraft bot is not running.');
    }
  } else if (content === '/rs') {
    if (bot) {
      bot.quit('Restarting');
      cleanUpBot();
      setTimeout(() => {
        createBot();
        message.channel.send('Minecraft bot restarted.');
      }, 3000);
    } else {
      message.channel.send('Minecraft bot is not running.');
    }
  } else if (content === '/pn') {
    sendMinecraftToDiscord = !sendMinecraftToDiscord;
    message.channel.send(sendMinecraftToDiscord ? 'Minecraft messages enabled in this channel.' : 'Minecraft messages disabled.');
  } else if (bot && bot.chat) {
    bot.chat(content);
    message.react('✅');
  }
});

discordClient.login(discordToken);
