(function () {
  "use strict";

  const GAME_SECONDS = 45;
  const BASE_VISIBLE_MS = 980;
  const MIN_VISIBLE_MS = 540;
  const FAST_TARGET_MULTIPLIER = 0.66;
  const BASE_SPAWN_MS = 760;
  const MIN_SPAWN_MS = 330;
  const IMPACT_EFFECT_MS = 420;
  const STORAGE_KEY = "hammer-head-best-score";
  const LEADERBOARD_API_URL = (window.LEADERBOARD_API_URL || "").replace(/\/+$/, "");
  const AUDIO_SLOTS = {
    hammerHit: { src: "./assets/sounds/hammer-hit.mp3", volume: 0.95 },
    hammerMiss: { src: "./assets/sounds/hammer-miss.mp3", volume: 0.9 },
    characterNormal: { src: "./assets/sounds/character-normal.mp3", volume: 0.85 },
    characterBonus: { src: "./assets/sounds/character-bonus.mp3", volume: 0.9 },
    characterFast: { src: "./assets/sounds/character-fast.mp3", volume: 0.85 },
    targetPop: { src: "./assets/sounds/target-pop.mp3", volume: 0.55 },
    roundStart: { src: "./assets/sounds/round-start.mp3", volume: 0.85 },
    gameOver: { src: "./assets/sounds/game-over.mp3", volume: 0.85 },
    record: { src: "./assets/sounds/record.mp3", volume: 0.9 },
    menuMusic: { src: "./assets/sounds/menu-music.mp3", volume: 0.38, loop: true },
    gameMusic: { src: "./assets/sounds/game-music.mp3", volume: 0.34, loop: true },
    endMusic: { src: "./assets/sounds/end-music.mp3", volume: 0.36, loop: true }
  };
  const PROCEDURAL_MUSIC = {
    menuMusic: {
      bpm: 92,
      wave: "triangle",
      volume: 0.026,
      bassVolume: 0.018,
      notes: [392, 494, 523, 659, 587, 523, 494, 440],
      bass: [196, 196, 220, 220, 174, 174, 196, 196]
    },
    gameMusic: {
      bpm: 132,
      wave: "square",
      volume: 0.022,
      bassVolume: 0.026,
      notes: [523, 659, 784, 659, 587, 740, 880, 740],
      bass: [131, 131, 165, 165, 147, 147, 196, 196]
    },
    endMusic: {
      bpm: 84,
      wave: "sine",
      volume: 0.026,
      bassVolume: 0.02,
      notes: [659, 587, 523, 494, 440, 494, 523, 392],
      bass: [165, 165, 147, 147, 131, 131, 196, 196]
    }
  };

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const arena = document.getElementById("arena");
  const holes = Array.from(document.querySelectorAll(".hole"));
  const scoreEl = document.getElementById("score");
  const timeEl = document.getElementById("time");
  const comboEl = document.getElementById("combo");
  const bestEl = document.getElementById("best");
  const panel = document.getElementById("panel");
  const panelTitle = document.getElementById("panel-title");
  const panelText = document.getElementById("panel-text");
  const startButton = document.getElementById("start-button");
  const restartButton = document.getElementById("restart-button");
  const sendButton = document.getElementById("send-button");
  const soundToggle = document.getElementById("sound-toggle");
  const telegramStatus = document.getElementById("telegram-status");
  const leaderboard = document.getElementById("leaderboard");
  const leaderboardList = document.getElementById("leaderboard-list");
  const hammer = document.getElementById("hammer");

  let running = false;
  let score = 0;
  let bestScore = readBestScore();
  let combo = 0;
  let hits = 0;
  let misses = 0;
  let activeTargets = new Map();
  let startedAt = 0;
  let gameTimer = 0;
  let spawnTimer = 0;
  let audioEnabled = true;
  let audioContext = null;
  let availableAudio = new Set();
  let audioElements = new Map();
  let currentMusic = null;
  let screenMode = "menu";
  let audioPrimed = false;
  let proceduralMusicKey = null;
  let proceduralMusicTimer = 0;
  let proceduralMusicStep = 0;
  let leaderboardGroup = getLeaderboardGroup();
  let lastSubmittedScoreKey = "";
  let scoreSubmitPromise = null;
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  bestEl.textContent = String(bestScore);
  timeEl.textContent = String(GAME_SECONDS);
  setSoundButton();

  setupTelegram();
  discoverCustomAudio();
  bindEvents();
  render();
  loadLeaderboard();

  function setupTelegram() {
    if (!tg) {
      setSubmitStatus("Сейчас открыт браузерный режим. Для leaderboard откройте игру через /play в Telegram.");
      return;
    }

    document.documentElement.classList.add("inside-telegram");
    setSubmitStatus("Telegram подключен. Результат отправится в leaderboard после игры.");

    applyTelegramTheme();
    tg.ready();
    tg.expand();

    if (typeof tg.disableVerticalSwipes === "function") {
      tg.disableVerticalSwipes();
    }

    if (typeof tg.setHeaderColor === "function") {
      tg.setHeaderColor(tg.themeParams.bg_color || "#f6fbff");
    }

    if (tg.MainButton) {
      tg.MainButton.setText("Отправить результат");
      tg.MainButton.onClick(sendResult);
      tg.MainButton.hide();
    }
  }

  function applyTelegramTheme() {
    if (!tg || !tg.themeParams) {
      return;
    }

    const params = tg.themeParams;
    setVar("--bg", params.bg_color);
    setVar("--text", params.text_color);
    setVar("--muted", params.hint_color);
    setVar("--accent", params.button_color);
    setVar("--accent-strong", params.link_color || params.button_color);
    setVar("--panel-solid", params.secondary_bg_color);
  }

  function setVar(name, value) {
    if (value) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  function bindEvents() {
    startButton.addEventListener("click", startGame);
    restartButton.addEventListener("click", startGame);
    sendButton.addEventListener("click", sendResult);
    soundToggle.addEventListener("click", toggleSound);

    document.addEventListener("pointerdown", primeAudio, {
      capture: true
    });

    holes.forEach((hole) => {
      hole.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        moveHammer(event.clientX, event.clientY);
        strikeHole(hole, event.clientX, event.clientY);
      });
    });

    window.addEventListener("pointermove", (event) => {
      moveHammer(event.clientX, event.clientY);
    });

    window.addEventListener("pointerdown", (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
      moveHammer(event.clientX, event.clientY);

      if (arena.contains(event.target) && !event.target.closest(".hole")) {
        swingHammer("miss");
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && running) {
        endGame(true);
      }
    });
  }

  function startGame() {
    clearTimers();
    clearTargets();
    clearVisualEffects();

    running = true;
    score = 0;
    combo = 0;
    hits = 0;
    misses = 0;
    startedAt = performance.now();
    screenMode = "game";
    lastSubmittedScoreKey = "";
    scoreSubmitPromise = null;
    panel.classList.add("hidden");
    sendButton.classList.add("hidden");
    setSubmitStatus(tg ? "Игра идет. Результат отправится после раунда." : "Игра идет в браузере. Leaderboard работает только через Telegram /play.");

    if (tg && tg.MainButton) {
      tg.MainButton.hide();
    }

    render();
    stopMusic("menuMusic");
    stopMusic("endMusic");
    playMusicForScreen();
    playSound("start");
    scheduleSpawn(120);
    gameTimer = window.setInterval(tick, 120);
    haptic("impact", "light");
  }

  function tick() {
    const elapsed = (performance.now() - startedAt) / 1000;
    const remaining = Math.max(0, GAME_SECONDS - elapsed);
    timeEl.textContent = String(Math.ceil(remaining));
    timeEl.closest(".stat").classList.toggle("is-warning", remaining <= 10);

    if (remaining <= 0) {
      endGame(false);
    }
  }

  function scheduleSpawn(delay) {
    window.clearTimeout(spawnTimer);
    spawnTimer = window.setTimeout(() => {
      if (!running) {
        return;
      }

      spawnTarget();
      const progress = getProgress();
      const nextDelay = Math.round(lerp(BASE_SPAWN_MS, MIN_SPAWN_MS, progress) + random(-80, 90));
      scheduleSpawn(Math.max(MIN_SPAWN_MS, nextDelay));
    }, delay);
  }

  function spawnTarget() {
    const available = holes.filter((hole) => !activeTargets.has(Number(hole.dataset.index)));
    if (!available.length) {
      return;
    }

    const progress = getProgress();
    const maxActive = progress > 0.72 ? 3 : progress > 0.35 ? 2 : 1;
    if (activeTargets.size >= maxActive) {
      return;
    }

    const hole = available[Math.floor(Math.random() * available.length)];
    const index = Number(hole.dataset.index);
    const type = pickTargetType();
    const visibleMs = getVisibleMs(type, progress);

    hole.classList.add("is-up");
    hole.classList.toggle("is-bonus", type === "bonus");
    hole.classList.toggle("is-fast", type === "fast");

    const timeout = window.setTimeout(() => {
      if (!activeTargets.has(index)) {
        return;
      }

      activeTargets.delete(index);
      hole.classList.remove("is-up", "is-bonus", "is-fast");
      combo = 0;
      misses += 1;
      render();
    }, visibleMs);

    activeTargets.set(index, {
      type,
      timeout
    });

    playSound(type === "fast" ? "spawn-fast" : "spawn");
  }

  function pickTargetType() {
    const roll = Math.random();
    if (roll < 0.14) {
      return "bonus";
    }

    if (roll < 0.34) {
      return "fast";
    }

    return "normal";
  }

  function getVisibleMs(type, progress) {
    const base = Math.round(lerp(BASE_VISIBLE_MS, MIN_VISIBLE_MS, progress) + random(-90, 100));
    const multiplier = type === "fast" ? FAST_TARGET_MULTIPLIER : 1;
    return Math.max(MIN_VISIBLE_MS * multiplier, Math.round(base * multiplier));
  }

  function strikeHole(hole, x, y) {
    if (!running) {
      return;
    }

    const index = Number(hole.dataset.index);
    const target = activeTargets.get(index);
    swingHammer(target ? target.type : "miss");

    if (!target) {
      combo = 0;
      misses += 1;
      score = Math.max(0, score - 3);
      flashHole(hole, "miss");
      shakeScreen("miss");
      flashScreen("miss");
      createImpact(x, y, "miss");
      showFloat("-3", x, y, true);
      playSound("miss");
      haptic("notification", "error");
      render();
      pulseStat(scoreEl, "bad");
      return;
    }

    window.clearTimeout(target.timeout);
    activeTargets.delete(index);

    combo += 1;
    hits += 1;

    const base = target.type === "bonus" ? 25 : target.type === "fast" ? 16 : 10;
    const points = base + Math.min(30, combo * 2);
    score += points;

    hole.classList.add("is-bonk");
    flashHole(hole, target.type === "bonus" ? "heavy" : "hit");
    shakeScreen(target.type);
    flashScreen(target.type);
    hole.classList.remove("is-up");
    window.setTimeout(() => hole.classList.remove("is-bonk", "is-bonus", "is-fast"), 260);

    createImpact(x, y, target.type);
    showFloat(`+${points}`, x, y, false);
    if (combo >= 3 && combo % 3 === 0) {
      showComboToast(combo, x, y);
    }
    playSound(`hit-${target.type}`);
    haptic("impact", target.type === "bonus" ? "heavy" : "medium");
    render();
    pulseStat(scoreEl, target.type === "bonus" ? "gold" : "good");
    pulseStat(comboEl, combo >= 3 ? "combo" : "good");
  }

  function flashHole(hole, type) {
    const className = type === "miss" ? "is-miss" : type === "heavy" ? "is-heavy-hit" : "is-hit";
    const arenaClass = type === "miss" ? "is-miss-impact" : type === "heavy" ? "is-hard-impact" : "is-impact";

    hole.classList.remove("is-miss", "is-hit", "is-heavy-hit");
    arena.classList.remove("is-miss-impact", "is-impact", "is-hard-impact");

    void hole.offsetWidth;
    hole.classList.add(className);
    arena.classList.add(arenaClass);

    window.setTimeout(() => {
      hole.classList.remove(className);
      arena.classList.remove(arenaClass);
    }, IMPACT_EFFECT_MS);
  }

  function endGame(interrupted) {
    if (!running) {
      return;
    }

    running = false;
    clearTimers();
    clearTargets();

    const previousBest = bestScore;
    const isRecord = score > previousBest;
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem(STORAGE_KEY, String(bestScore));
    }
    screenMode = "end";

    render();

    panel.classList.remove("hidden");
    sendButton.classList.toggle("hidden", !tg);
    panelTitle.textContent = interrupted ? "Игра остановлена" : "Раунд завершен";
    panelText.textContent = buildResultText(previousBest);
    startButton.textContent = "Играть еще";
    timeEl.closest(".stat").classList.remove("is-warning");

    if (tg && tg.MainButton) {
      tg.MainButton.show();
    }

    showEndEffect(isRecord, interrupted);
    submitScore("auto");
    stopMusic("gameMusic");
    playMusicForScreen();
    playSound(isRecord ? "record" : "game-over");
    haptic("notification", isRecord ? "success" : "warning");
  }

  function buildResultText(previousBest) {
    const bestPart = score > previousBest ? "Новый рекорд." : `Рекорд: ${bestScore}.`;
    return `Очки: ${score}. Попадания: ${hits}. Промахи: ${misses}. ${bestPart}`;
  }

  async function sendResult() {
    const sentToLeaderboard = await submitScore("manual");

    if (sentToLeaderboard) {
      haptic("notification", "success");
      return;
    }

    if (!tg || !tg.initData) {
      showTelegramAlert("Откройте игру через кнопку /play в Telegram. Обычная ссылка в браузере не может отправить результат.");
      return;
    }

    showTelegramAlert("Не удалось отправить результат в leaderboard. Проверьте Render Logs и URL Mini App в BotFather.");
  }

  async function submitScore(reason) {
    if (!leaderboardGroup) {
      setSubmitStatus("Не удалось определить группу для leaderboard.", "error");
      return false;
    }

    if (!tg || !tg.initData) {
      setSubmitStatus("Результат не отправлен: откройте игру через кнопку /play в Telegram.", "error");
      return false;
    }

    const submitKey = getScoreSubmitKey();
    if (lastSubmittedScoreKey === submitKey) {
      setSubmitStatus(`Результат уже в leaderboard. Ваш рекорд: ${bestScore}.`, "success");
      return true;
    }

    if (scoreSubmitPromise) {
      if (reason === "manual") {
        setSubmitStatus("Результат уже отправляется в leaderboard...");
      }
      return scoreSubmitPromise;
    }

    setSubmitStatus("Отправляю результат в leaderboard...");

    scoreSubmitPromise = (async () => {
      const response = await fetch(apiUrl("/api/score"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          initData: tg.initData,
          group: leaderboardGroup,
          score,
          hits,
          misses,
          durationSeconds: GAME_SECONDS
        })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSubmitStatus(getSubmitHttpErrorText(response.status), "error");
        return false;
      }

      if (data.ok && data.leaderboard) {
        lastSubmittedScoreKey = submitKey;
        if (Number.isFinite(Number(data.best))) {
          bestScore = Math.max(bestScore, Number(data.best));
          bestEl.textContent = String(bestScore);
        }
        renderLeaderboard(data.leaderboard);
        setSubmitStatus(`Результат отправлен. Ваш рекорд: ${data.best}.`, "success");
        return true;
      }

      setSubmitStatus(getSubmitApiErrorText(data && data.error), "error");
      return false;
    })()
      .catch((error) => {
        console.warn("Leaderboard submit failed", error);
        setSubmitStatus("Не удалось связаться с leaderboard. Проверьте, что Render deploy работает.", "error");
        return false;
      })
      .finally(() => {
        scoreSubmitPromise = null;
      });

    return scoreSubmitPromise;
  }

  async function loadLeaderboard() {
    if (!leaderboardGroup) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/leaderboard?group=${encodeURIComponent(leaderboardGroup)}`), {
        cache: "no-store"
      });
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data.ok && data.leaderboard) {
        renderLeaderboard(data.leaderboard);
      }
    } catch (error) {
      // GitHub Pages does not provide the leaderboard API. The game still works without it.
    }
  }

  function renderLeaderboard(items) {
    if (!leaderboard || !leaderboardList) {
      return;
    }

    leaderboardList.innerHTML = "";

    if (!items.length) {
      leaderboard.classList.add("hidden");
      return;
    }

    items.slice(0, 5).forEach((entry) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const scoreValue = document.createElement("strong");
      name.textContent = `${entry.rank}. ${entry.name}`;
      scoreValue.textContent = String(entry.best);
      item.append(name, scoreValue);
      leaderboardList.appendChild(item);
    });

    leaderboard.classList.remove("hidden");
  }

  function apiUrl(path) {
    return `${LEADERBOARD_API_URL}${path}`;
  }

  function getScoreSubmitKey() {
    return [leaderboardGroup, score, hits, misses, Math.round(startedAt)].join(":");
  }

  function setSubmitStatus(message, state) {
    if (!telegramStatus) {
      return;
    }

    telegramStatus.textContent = message;
    telegramStatus.classList.toggle("is-error", state === "error");
    telegramStatus.classList.toggle("is-success", state === "success");
  }

  function getSubmitHttpErrorText(status) {
    if (status === 404) {
      return "Leaderboard API не найден. В BotFather укажите Render URL, а не GitHub Pages.";
    }

    return `Ошибка leaderboard API: ${status}. Проверьте Render Logs.`;
  }

  function getSubmitApiErrorText(errorCode) {
    switch (errorCode) {
      case "missing_init_data":
        return "Telegram не передал данные игрока. Откройте игру через /play.";
      case "expired_init_data":
        return "Сессия Telegram устарела. Закройте игру и откройте заново через /play.";
      case "bad_signature":
        return "Telegram не подтвердил игрока. Проверьте BOT_TOKEN на Render.";
      case "missing_hash":
      case "bad_user":
        return "Telegram передал неполные данные игрока. Откройте игру заново через /play.";
      default:
        return `Сервер не принял результат: ${errorCode || "unknown_error"}.`;
    }
  }

  function showTelegramAlert(message) {
    if (tg && typeof tg.showAlert === "function") {
      tg.showAlert(message);
      return;
    }

    window.alert(message);
  }

  function getLeaderboardGroup() {
    const params = new URLSearchParams(window.location.search);
    return params.get("g") || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "global";
  }

  function clearTimers() {
    window.clearInterval(gameTimer);
    window.clearTimeout(spawnTimer);
  }

  function clearTargets() {
    activeTargets.forEach((target) => window.clearTimeout(target.timeout));
    activeTargets.clear();
    holes.forEach((hole) => hole.classList.remove("is-up", "is-bonus", "is-fast", "is-bonk"));
  }

  function render() {
    scoreEl.textContent = String(score);
    comboEl.textContent = `x${combo}`;
    bestEl.textContent = String(bestScore);
  }

  function pulseStat(element, type) {
    element.classList.remove("is-pop", "is-pop-good", "is-pop-bad", "is-pop-gold", "is-pop-combo");
    void element.offsetWidth;
    element.classList.add("is-pop", `is-pop-${type}`);
    window.setTimeout(() => {
      element.classList.remove("is-pop", `is-pop-${type}`);
    }, 360);
  }

  function shakeScreen(type) {
    const className = type === "bonus" ? "is-screen-shake-heavy" : type === "miss" ? "is-screen-shake-miss" : "is-screen-shake";
    document.body.classList.remove("is-screen-shake", "is-screen-shake-heavy", "is-screen-shake-miss");
    arena.classList.remove("is-screen-shake", "is-screen-shake-heavy", "is-screen-shake-miss");
    void document.body.offsetWidth;
    document.body.classList.add(className);
    arena.classList.add(className);
    window.setTimeout(() => {
      document.body.classList.remove(className);
      arena.classList.remove(className);
    }, type === "bonus" ? 460 : 360);
  }

  function flashScreen(type) {
    const flash = document.createElement("div");
    flash.className = `hit-flash is-${type}`;
    document.body.appendChild(flash);
    window.setTimeout(() => flash.remove(), 420);
  }

  function showFloat(text, x, y, isMiss) {
    const node = document.createElement("span");
    node.className = `float-score${isMiss ? " miss" : ""}`;
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 650);
  }

  function showComboToast(value, x, y) {
    const node = document.createElement("span");
    node.className = "combo-toast";
    node.textContent = `COMBO x${value}`;
    node.style.left = `${Math.min(window.innerWidth - 90, Math.max(90, x))}px`;
    node.style.top = `${Math.max(90, y - 80)}px`;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 860);
  }

  function createImpact(x, y, type) {
    const burst = document.createElement("span");
    const sparkCount = type === "bonus" ? 28 : type === "miss" ? 14 : type === "fast" ? 20 : 18;
    burst.className = `impact-burst is-${type}`;
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;

    for (let index = 0; index < sparkCount; index += 1) {
      const spark = document.createElement("span");
      const angle = (360 / sparkCount) * index + random(-12, 12);
      const distance = type === "bonus" ? random(64, 98) : type === "miss" ? random(36, 68) : random(46, 76);
      spark.className = index % 3 === 0 && type !== "miss" ? "impact-spark is-star" : "impact-spark";
      spark.style.setProperty("--angle", `${angle}deg`);
      spark.style.setProperty("--distance", `${distance}px`);
      spark.style.setProperty("--spark-size", `${Math.round(random(10, 20))}px`);
      spark.style.animationDelay = `${random(0, 24)}ms`;
      burst.appendChild(spark);
    }

    document.body.appendChild(burst);
    window.setTimeout(() => burst.remove(), IMPACT_EFFECT_MS);
  }

  function showEndEffect(isRecord, interrupted) {
    if (interrupted) {
      shakeScreen("miss");
      return;
    }

    const flash = document.createElement("div");
    flash.className = `end-flash${isRecord ? " is-record" : ""}`;
    document.body.appendChild(flash);
    window.setTimeout(() => flash.remove(), 1200);

    const count = isRecord ? 86 : 42;
    for (let index = 0; index < count; index += 1) {
      const piece = document.createElement("span");
      const hue = isRecord ? Math.round(random(42, 196)) : Math.round(random(24, 92));
      piece.className = `confetti-piece${isRecord ? " is-record" : ""}`;
      piece.style.left = `${random(4, 96)}vw`;
      piece.style.setProperty("--fall-x", `${random(-80, 80)}px`);
      piece.style.setProperty("--spin", `${random(-540, 540)}deg`);
      piece.style.setProperty("--hue", String(hue));
      piece.style.animationDelay = `${random(0, 560)}ms`;
      piece.style.animationDuration = `${random(1500, 2600)}ms`;
      document.body.appendChild(piece);
      window.setTimeout(() => piece.remove(), 3300);
    }

    shakeScreen(isRecord ? "bonus" : "normal");
  }

  function clearVisualEffects() {
    document.querySelectorAll(".impact-burst, .float-score, .combo-toast, .confetti-piece, .end-flash, .hit-flash").forEach((node) => node.remove());
    timeEl.closest(".stat").classList.remove("is-warning");
    document.body.classList.remove("is-screen-shake", "is-screen-shake-heavy", "is-screen-shake-miss");
    arena.classList.remove("is-screen-shake", "is-screen-shake-heavy", "is-screen-shake-miss");
  }

  function moveHammer(x, y) {
    lastPointer = { x, y };
    hammer.style.left = `${x}px`;
    hammer.style.top = `${y}px`;
    hammer.classList.add("visible");
  }

  function swingHammer(type) {
    moveHammer(lastPointer.x, lastPointer.y);
    hammer.classList.remove("strike", "strike-hard", "strike-miss", "strike-fast");
    hammer.classList.toggle("strike-hard", type === "bonus");
    hammer.classList.toggle("strike-fast", type === "fast");
    hammer.classList.toggle("strike-miss", type === "miss");
    void hammer.offsetWidth;
    hammer.classList.add("strike");
  }

  function toggleSound() {
    audioEnabled = !audioEnabled;
    setSoundButton();

    if (!audioEnabled) {
      stopAllMusic();
      return;
    }

    primeAudio();

    if (!running) {
      playMusicForScreen();
    }

    if (audioEnabled) {
      ensureAudio();
      playSound("toggle");
    }
  }

  function setSoundButton() {
    soundToggle.textContent = audioEnabled ? "Звук: вкл" : "Звук: выкл";
    soundToggle.setAttribute("aria-pressed", String(audioEnabled));
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        audioContext = new AudioCtor();
      }
    }

    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  }

  function discoverCustomAudio() {
    Object.entries(AUDIO_SLOTS).forEach(([key, config]) => {
      fetch(config.src, {
        method: "HEAD",
        cache: "no-store"
      })
        .then((response) => {
          if (!response.ok) {
            return;
          }

          const audio = new Audio(config.src);
          audio.preload = "auto";
          audio.loop = Boolean(config.loop);
          audio.volume = config.volume;
          availableAudio.add(key);
          audioElements.set(key, audio);

          if (audioEnabled && audioPrimed && key === getScreenMusicKey()) {
            if (proceduralMusicKey === key) {
              stopMusic(key);
            }

            playMusicForScreen();
          }
        })
        .catch(() => {});
    });
  }

  function primeAudio() {
    if (!audioEnabled) {
      return;
    }

    audioPrimed = true;
    ensureAudio();

    playMusicForScreen();
  }

  function playSound(name) {
    if (!audioEnabled) {
      return;
    }

    ensureAudio();
    if (playCustomSound(name)) {
      return;
    }

    if (!audioContext) {
      return;
    }

    switch (name) {
      case "start":
        tone(420, 0, 0.06, "triangle", 0.1, 520);
        tone(620, 0.07, 0.08, "triangle", 0.11, 760);
        break;
      case "spawn":
        tone(460, 0, 0.035, "sine", 0.035, 610);
        break;
      case "spawn-fast":
        tone(780, 0, 0.028, "square", 0.032, 980);
        tone(980, 0.035, 0.026, "square", 0.026, 760);
        break;
      case "hit-normal":
        noiseBurst(0, 0.07, 0.12, 900);
        tone(210, 0, 0.08, "sine", 0.16, 94);
        tone(520, 0.012, 0.05, "triangle", 0.045, 420);
        break;
      case "hit-fast":
        noiseBurst(0, 0.055, 0.1, 1300);
        tone(880, 0, 0.06, "square", 0.06, 360);
        tone(1280, 0.022, 0.04, "triangle", 0.04, 820);
        break;
      case "hit-bonus":
        noiseBurst(0, 0.08, 0.14, 1600);
        tone(260, 0, 0.09, "sine", 0.14, 120);
        tone(660, 0.02, 0.08, "triangle", 0.08, 760);
        tone(880, 0.08, 0.08, "triangle", 0.075, 1040);
        tone(1180, 0.15, 0.1, "sine", 0.065, 1320);
        break;
      case "miss":
        noiseBurst(0, 0.09, 0.07, 430);
        tone(150, 0, 0.11, "sawtooth", 0.095, 72);
        break;
      case "record":
        tone(620, 0, 0.08, "triangle", 0.08, 760);
        tone(820, 0.08, 0.08, "triangle", 0.08, 980);
        tone(1040, 0.16, 0.11, "triangle", 0.075, 1320);
        tone(520, 0.03, 0.23, "sine", 0.035, 520);
        break;
      case "game-over":
        tone(520, 0, 0.08, "triangle", 0.07, 420);
        tone(360, 0.09, 0.1, "triangle", 0.06, 260);
        break;
      case "toggle":
        tone(540, 0, 0.055, "triangle", 0.06, 680);
        break;
      default:
        break;
    }
  }

  function playCustomSound(name) {
    switch (name) {
      case "start":
        return playClip("roundStart");
      case "spawn":
      case "spawn-fast":
        return playClip("targetPop");
      case "hit-normal": {
        let played = playClip("hammerHit");
        played = playClip("characterNormal") || played;
        return played;
      }
      case "hit-fast": {
        let played = playClip("hammerHit");
        played = playClip("characterFast") || played;
        return played;
      }
      case "hit-bonus": {
        let played = playClip("hammerHit");
        played = playClip("characterBonus") || played;
        return played;
      }
      case "miss":
        return playClip("hammerMiss");
      case "record":
        return playClip("record") || playClip("gameOver");
      case "game-over":
        return playClip("gameOver");
      default:
        return false;
    }
  }

  function playClip(key) {
    if (!audioEnabled || !availableAudio.has(key)) {
      return false;
    }

    const source = audioElements.get(key);
    if (!source) {
      return false;
    }

    try {
      const clip = source.cloneNode(true);
      clip.volume = source.volume;
      clip.play().catch(() => {});
      return true;
    } catch (error) {
      return false;
    }
  }

  function playMusic(key) {
    if (!audioEnabled || !audioPrimed) {
      return;
    }

    if (currentMusic === key) {
      return;
    }

    stopAllMusic();

    if (!availableAudio.has(key)) {
      startProceduralMusic(key);
      return;
    }

    const music = audioElements.get(key);
    if (!music) {
      startProceduralMusic(key);
      return;
    }

    music.currentTime = 0;
    music.play()
      .then(() => {
        currentMusic = key;
      })
      .catch(() => {
        currentMusic = null;
        startProceduralMusic(key);
      });
  }

  function stopMusic(key) {
    if (currentMusic !== key) {
      return;
    }

    const music = audioElements.get(key);
    if (music) {
      music.pause();
      music.currentTime = 0;
    }

    if (proceduralMusicKey === key) {
      stopProceduralMusic();
    }

    currentMusic = null;
  }

  function stopAllMusic() {
    ["menuMusic", "gameMusic", "endMusic"].forEach((key) => {
      const music = audioElements.get(key);
      if (music) {
        music.pause();
        music.currentTime = 0;
      }
    });
    stopProceduralMusic();
    currentMusic = null;
  }

  function playMusicForScreen() {
    playMusic(getScreenMusicKey());
  }

  function getScreenMusicKey() {
    if (screenMode === "game") {
      return "gameMusic";
    }

    if (screenMode === "end") {
      return "endMusic";
    }

    return "menuMusic";
  }

  function startProceduralMusic(key) {
    if (!audioContext || !PROCEDURAL_MUSIC[key]) {
      return;
    }

    stopProceduralMusic();
    proceduralMusicKey = key;
    proceduralMusicStep = 0;
    currentMusic = key;
    scheduleProceduralMusic();
  }

  function stopProceduralMusic() {
    window.clearTimeout(proceduralMusicTimer);
    proceduralMusicTimer = 0;
    proceduralMusicKey = null;
    proceduralMusicStep = 0;
  }

  function scheduleProceduralMusic() {
    if (!audioEnabled || !audioPrimed || !audioContext || !proceduralMusicKey) {
      stopProceduralMusic();
      return;
    }

    const pattern = PROCEDURAL_MUSIC[proceduralMusicKey];
    const step = proceduralMusicStep;
    const beat = 60 / pattern.bpm;
    const stepDuration = beat / 2;
    const note = pattern.notes[step % pattern.notes.length];
    const bass = pattern.bass[Math.floor(step / 2) % pattern.bass.length];

    if (note) {
      tone(note, 0, stepDuration * 0.82, pattern.wave, pattern.volume, note * 1.004);
    }

    if (step % 2 === 0 && bass) {
      tone(bass, 0, beat * 0.9, "sine", pattern.bassVolume, bass * 0.998);
    }

    if (proceduralMusicKey === "gameMusic" && step % 4 === 2) {
      noiseBurst(0, 0.045, 0.018, 1800);
    }

    if (proceduralMusicKey === "endMusic" && step % 8 === 0) {
      tone(note / 2, 0.05, beat * 1.4, "sine", 0.016, note / 2);
    }

    proceduralMusicStep += 1;
    proceduralMusicTimer = window.setTimeout(scheduleProceduralMusic, stepDuration * 1000);
  }

  function tone(frequency, startOffset, duration, type, volume, endFrequency) {
    const now = audioContext.currentTime + startOffset;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + Math.min(0.012, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function noiseBurst(startOffset, duration, volume, filterFrequency) {
    const now = audioContext.currentTime + startOffset;
    const sampleRate = audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < length; index += 1) {
      const fade = 1 - index / length;
      data[index] = (Math.random() * 2 - 1) * fade;
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();

    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  function haptic(kind, value) {
    if (tg && tg.HapticFeedback) {
      if (kind === "impact" && typeof tg.HapticFeedback.impactOccurred === "function") {
        tg.HapticFeedback.impactOccurred(value);
      }

      if (kind === "notification" && typeof tg.HapticFeedback.notificationOccurred === "function") {
        tg.HapticFeedback.notificationOccurred(value);
      }

      return;
    }

    if (navigator.vibrate) {
      navigator.vibrate(kind === "impact" ? 18 : [18, 30, 18]);
    }
  }

  function getProgress() {
    if (!running) {
      return 0;
    }

    return Math.min(1, Math.max(0, (performance.now() - startedAt) / (GAME_SECONDS * 1000)));
  }

  function readBestScore() {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }
})();
