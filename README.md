# O`nь

Мини-игра для Telegram: головы выскакивают из механических люков, игрок бьет по ним молотком, набирает очки, комбо и отправляет результат боту.

## Что внутри

- `index.html`, `styles.css`, `game.js` - сама игра без внешних зависимостей.
- `assets/game-background.png` - кастомный фон.
- `assets/character-normal.png`, `assets/character-bonus.png`, `assets/character-fast.png` - кастомные прозрачные персонажи.
- `server.js` - простой локальный статический сервер.
- `bot.js` - пример Telegram-бота без библиотек: отправляет кнопку Web App и принимает результат через `web_app_data`.
- Звуки генерируются через WebAudio в `game.js`, поэтому отдельные аудиофайлы не нужны.

## Локальный запуск

```powershell
cd C:\Users\Абдурахмон\telegram-hammer-game
node server.js
```

Откройте:

```text
http://localhost:8080
```

## Запуск как Telegram Mini App

1. Создайте бота через `@BotFather`.
2. Разместите папку игры на HTTPS-хостинге. Для Telegram нужен публичный HTTPS URL.
3. В `@BotFather` откройте `/mybots` -> ваш бот -> `Bot Settings` -> `Configure Mini App` и укажите URL игры.
4. Для запуска через кнопку можно использовать пример `bot.js`.

Windows PowerShell:

```powershell
$env:BOT_TOKEN="123456:ABC..."
$env:WEB_APP_URL="https://your-domain.example/"
node bot.js
```

После команды `/play` бот отправит кнопку `Играть`. Когда пользователь завершит раунд, игра вызовет `Telegram.WebApp.sendData(...)`, а бот получит результат в `message.web_app_data`.

## Важные замечания

- Этот проект использует формат Telegram Mini App. Это самый простой вариант для HTML5-игры внутри Telegram.
- Для официальных Telegram Game high scores через `setGameScore` нужен отдельный сервер и запуск через Bot API game short name.
- Результаты в `bot.js` хранятся в локальном `scores.json`; для продакшена лучше заменить на базу данных.

## Документация Telegram

- Mini Apps: https://core.telegram.org/bots/webapps
- Gaming Platform: https://core.telegram.org/bots/games
- Bot API `setGameScore`: https://core.telegram.org/bots/api#setgamescore

## Замена картинок и звуков

Можно заменить картинки персонажей своими PNG с прозрачным фоном. Просто положите файлы с теми же именами:

- `assets/character-normal.png`
- `assets/character-bonus.png`
- `assets/character-fast.png`
- `assets/hammer.png`
- `assets/game-background.png`

Для своих звуков положите MP3-файлы в `assets/sounds`. Полный список имен есть в `assets/sounds/README.md`. Если какого-то аудиофайла нет, игра автоматически использует встроенный WebAudio-звук или встроенную WebAudio-музыку.

В игре есть визуальные эффекты: сильная тряска экрана, полноэкранная вспышка удара, крупные искры, комбо-плашки, предупреждение таймера и конфетти в конце раунда.
