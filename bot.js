"use strict";

const fs = require("node:fs");
const path = require("node:path");

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const scoresFile = process.env.SCORES_FILE || path.join(__dirname, "scores.json");

if (!token || !webAppUrl) {
  console.error("Set BOT_TOKEN and WEB_APP_URL before running the bot.");
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
let offset = 0;
let scores = loadScores();

poll().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function poll() {
  console.log("Bot is polling Telegram updates.");

  while (true) {
    const result = await call("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"]
    });

    for (const update of result) {
      offset = update.update_id + 1;
      await handleUpdate(update);
    }
  }
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message) {
    return;
  }

  if (message.web_app_data && message.web_app_data.data) {
    await handleScore(message);
    return;
  }

  const text = (message.text || "").trim().toLowerCase();
  if (text === "/start" || text === "/play" || text === "играть") {
    await sendPlayButton(message.chat.id);
    return;
  }

  await call("sendMessage", {
    chat_id: message.chat.id,
    text: "Нажмите /play, чтобы открыть игру."
  });
}

async function sendPlayButton(chatId) {
  await call("sendMessage", {
    chat_id: chatId,
    text: "Откройте игру Hammer Head и набейте максимум очков.",
    reply_markup: {
      keyboard: [
        [
          {
            text: "Играть",
            web_app: {
              url: webAppUrl
            }
          }
        ]
      ],
      resize_keyboard: true
    }
  });
}

async function handleScore(message) {
  let data;
  try {
    data = JSON.parse(message.web_app_data.data);
  } catch (error) {
    await call("sendMessage", {
      chat_id: message.chat.id,
      text: "Не смог прочитать результат игры."
    });
    return;
  }

  const score = Number(data.score || 0);
  const user = message.from || {};
  const key = String(user.id || message.chat.id);
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";

  const previous = scores[key] || { best: 0, name };
  const best = Math.max(previous.best || 0, score);
  scores[key] = {
    best,
    name,
    updatedAt: new Date().toISOString()
  };
  saveScores(scores);

  const leaderboard = Object.values(scores)
    .sort((a, b) => b.best - a.best)
    .slice(0, 5)
    .map((entry, index) => `${index + 1}. ${entry.name}: ${entry.best}`)
    .join("\n");

  await call("sendMessage", {
    chat_id: message.chat.id,
    text: `Ваш результат: ${score}\nВаш рекорд: ${best}\n\nТоп игроков:\n${leaderboard}`
  });
}

async function call(method, payload) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!json.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(json)}`);
  }

  return json.result;
}

function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(scoresFile, "utf8"));
  } catch (error) {
    return {};
  }
}

function saveScores(value) {
  fs.writeFileSync(scoresFile, `${JSON.stringify(value, null, 2)}\n`);
}
