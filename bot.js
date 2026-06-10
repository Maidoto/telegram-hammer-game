"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const token = process.env.BOT_TOKEN;
const publicUrl = normalizeUrl(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || process.env.WEB_APP_URL || "");
const botUsername = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const miniAppName = process.env.MINI_APP_NAME || "";
const scoresFile = process.env.SCORES_FILE || path.join(__dirname, "scores.json");
const port = Number(process.env.PORT || 8080);
const root = __dirname;

if (!token || !publicUrl) {
  console.error("Set BOT_TOKEN and PUBLIC_URL before running the bot server.");
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4"
};

let offset = 0;
let scores = loadScores();

startServer();
poll().catch((error) => {
  console.error(error);
  process.exit(1);
});

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { ok: false, error: "server_error" });
    }
  });

  server.listen(port, () => {
    console.log(`Game and leaderboard server is running at http://localhost:${port}`);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const group = normalizeGroupKey(url.searchParams.get("group") || "global");
    sendJson(res, 200, {
      ok: true,
      group,
      leaderboard: getLeaderboard(group)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/score") {
    const body = await readJson(req);
    const result = saveScoreFromWebApp(body);
    sendJson(res, 200, result);
    return;
  }

  serveStatic(url, res);
}

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
    await handlePrivateWebAppScore(message);
    return;
  }

  const text = (message.text || "").trim().toLowerCase().split("@")[0];

  if (text === "/start") {
    await sendHelp(message.chat.id);
    return;
  }

  if (text === "/play" || text === "играть") {
    await sendPlayButton(message.chat);
    return;
  }

  if (text === "/top" || text === "/leaderboard") {
    await sendLeaderboard(message.chat);
    return;
  }

  if (message.chat.type === "private") {
    await sendHelp(message.chat.id);
  }
}

async function sendHelp(chatId) {
  await call("sendMessage", {
    chat_id: chatId,
    text: "Команды:\n/play - открыть игру\n/top - показать leaderboard\n\nДобавьте бота в группу и отправьте /play, чтобы соревноваться с друзьями."
  });
}

async function sendPlayButton(chat) {
  const group = encodeGroupKey(chat.id);
  const url = buildPlayUrl(group);
  const text = chat.type === "private"
    ? "Откройте игру O`nь и набейте максимум очков."
    : `Соревнование в группе: ${chat.title || "чат"}\nНажмите кнопку, сыграйте и попадите в leaderboard.`;

  await call("sendMessage", {
    chat_id: chat.id,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Играть",
            url
          }
        ]
      ]
    }
  });

  await sendLeaderboard(chat, false);
}

async function sendLeaderboard(chat, showEmpty = true) {
  const group = encodeGroupKey(chat.id);
  const leaderboard = getLeaderboard(group);

  if (!leaderboard.length && !showEmpty) {
    return;
  }

  await call("sendMessage", {
    chat_id: chat.id,
    text: formatLeaderboard(chat.title || "чат", leaderboard)
  });
}

async function handlePrivateWebAppScore(message) {
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

  const group = encodeGroupKey(message.chat.id);
  const result = upsertScore(group, message.from || {}, data);
  await call("sendMessage", {
    chat_id: message.chat.id,
    text: `Ваш результат: ${result.score}\nВаш рекорд: ${result.best}\n\n${formatLeaderboard("личный чат", getLeaderboard(group))}`
  });
}

function saveScoreFromWebApp(body) {
  const initData = String(body.initData || "");
  const auth = validateInitData(initData);
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.error
    };
  }

  const user = auth.user || {};
  const group = normalizeGroupKey(body.group || auth.startParam || "global");
  const result = upsertScore(group, user, body);

  return {
    ok: true,
    group,
    score: result.score,
    best: result.best,
    leaderboard: getLeaderboard(group)
  };
}

function upsertScore(group, user, data) {
  const score = clampScore(data.score);
  const userId = String(user.id || "unknown");
  const name = formatUserName(user);
  const chat = scores.chats[group] || { title: group, players: {} };
  const previous = chat.players[userId] || { best: 0, name };
  const best = Math.max(Number(previous.best || 0), score);

  chat.players[userId] = {
    name,
    username: user.username || previous.username || "",
    best,
    last: score,
    hits: Number(data.hits || 0),
    misses: Number(data.misses || 0),
    updatedAt: new Date().toISOString()
  };

  scores.chats[group] = chat;
  saveScores(scores);

  return {
    score,
    best
  };
}

function getLeaderboard(group) {
  const chat = scores.chats[group];
  if (!chat) {
    return [];
  }

  return Object.values(chat.players)
    .sort((a, b) => b.best - a.best || String(a.name).localeCompare(String(b.name)))
    .slice(0, 10)
    .map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      username: entry.username,
      best: entry.best,
      last: entry.last,
      updatedAt: entry.updatedAt
    }));
}

function formatLeaderboard(title, leaderboard) {
  if (!leaderboard.length) {
    return `Leaderboard ${title}\nПока нет результатов. Нажмите /play и сыграйте первым.`;
  }

  const lines = leaderboard.map((entry) => {
    const username = entry.username ? ` (@${entry.username})` : "";
    return `${entry.rank}. ${entry.name}${username}: ${entry.best}`;
  });

  return `Leaderboard ${title}\n${lines.join("\n")}`;
}

function buildPlayUrl(group) {
  if (botUsername && miniAppName) {
    return `https://t.me/${botUsername}/${miniAppName}?startapp=${encodeURIComponent(group)}`;
  }

  if (botUsername) {
    return `https://t.me/${botUsername}?startapp=${encodeURIComponent(group)}`;
  }

  return `${publicUrl}?g=${encodeURIComponent(group)}`;
}

function validateInitData(initData) {
  if (!initData) {
    return { ok: false, error: "missing_init_data" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, error: "missing_hash" };
  }

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqual(hash, calculated)) {
    return { ok: false, error: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return { ok: false, error: "expired_init_data" };
  }

  let user = {};
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch (error) {
    return { ok: false, error: "bad_user" };
  }

  return {
    ok: true,
    user,
    startParam: params.get("start_param") || ""
  };
}

function serveStatic(url, res) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${pathname}`);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        req.destroy();
        reject(new Error("request_too_large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
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
    const data = JSON.parse(fs.readFileSync(scoresFile, "utf8"));
    return data.chats ? data : { chats: {} };
  } catch (error) {
    return { chats: {} };
  }
}

function saveScores(value) {
  fs.writeFileSync(scoresFile, `${JSON.stringify(value, null, 2)}\n`);
}

function formatUserName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
}

function clampScore(value) {
  const score = Number(value || 0);
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(999999, Math.round(score)));
}

function encodeGroupKey(chatId) {
  return Buffer.from(String(chatId)).toString("base64url");
}

function normalizeGroupKey(value) {
  return String(value || "global").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "global";
}

function normalizeUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
