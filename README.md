# 🎙️ Hangout Haven — ChatGPT AI Voice Bot

Automatic Discord voice conversation bot for **Hangout Haven | IN & BD Hangout**, built with Discord.js, `@discordjs/voice`, and the OpenAI API. Designed for Railway deployment.

## What it does

- `/join`: joins the command user's VC, listens for Discord members speaking, automatically transcribes speech, generates an AI response and speaks the response back into VC.
- `/leave`: disconnects.
- `/status`: shows connection and pending queue.
- `/reset`: clears the guild's in-memory conversation history.
- Hindi, Hinglish, English, Bangla: model attempts to respond in the speaker's language.
- Uses per-speaker audio capture and a bounded processing queue; **one AI response at a time**.
- Does not store audio recordings to disk. Audio is sent to OpenAI for processing; transcript snippets are printed to deployment logs, so protect log access.

**Important:** This is a starter implementation, not a guaranteed interruption-free or low-latency real-time voice experience. OpenAI transcription → chat → speech runs sequentially and introduces latency. The bot listens to *all* speaking users in the VC after `/join` (not just people who address it). Tell all members and obtain appropriate consent before using it. Do not use it in a channel where members do not expect audio processing.

## 1. Create a Discord application

1. Open https://discord.com/developers/applications and click **New Application**.
2. Give it a name such as `Hangout Haven AI`.
3. Open **Bot** and reset/copy the bot token. **Never share or commit this token.**
4. Under **General Information**, copy the **Application ID** (this is `DISCORD_CLIENT_ID`).
5. Open **Installation** / OAuth2 URL Generator. Select scopes `bot` and `applications.commands`, and bot permissions `View Channels`, `Connect`, `Speak` (plus `Send Messages` if desired). Use the generated install URL to add the bot to your server.
6. Turn on Discord Developer Mode in Discord settings, right-click the server, choose **Copy Server ID** (`GUILD_ID`). No Message Content intent is needed.

## 2. Create an OpenAI API key

1. Visit https://platform.openai.com/api-keys and create a key.
2. Make sure your API organization has an active billing arrangement and model access. **ChatGPT Plus does not include OpenAI API credits.**
3. Set `OPENAI_API_KEY` securely in Railway variables. Never paste the key into GitHub or screenshots.

## 3. Upload to GitHub

1. Extract this ZIP on your computer.
2. Create a new **private** repository on GitHub.
3. Upload the contents of the `hangout-haven-ai-voice` folder to the repository root (not the outer folder).
4. Do **not** upload `.env`, tokens, or `node_modules`. `.env.example` is safe as a template.

CLI alternative:

```bash
git init
git add .
git commit -m "Initial Hangout Haven AI voice bot"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

## 4. Deploy on Railway

1. Open https://railway.com/ and select **New Project → Deploy from GitHub repo**.
2. Select the repository and allow Railway access.
3. Railway should detect the included **Dockerfile**, install dependencies, and run `npm start`.
4. Open your Railway service → **Variables**, and add:

| Variable | Required | Example / meaning |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Discord Application ID |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `GUILD_ID` | Recommended | Discord server ID; makes slash commands register quickly for that server |
| `OPENAI_CHAT_MODEL` | No | `gpt-4o-mini` |
| `OPENAI_TRANSCRIBE_MODEL` | No | `gpt-4o-mini-transcribe` |
| `OPENAI_TTS_MODEL` | No | `tts-1` |
| `OPENAI_TTS_VOICE` | No | `alloy` |
| `BOT_PERSONA` | No | Custom AI instructions |
| `MIN_SPEECH_MS` | No | `650` |
| `MAX_SPEECH_MS` | No | `18000` |
| `SILENCE_MS` | No | `900` |
| `USER_COOLDOWN_MS` | No | `2200` |
| `MAX_HISTORY_MESSAGES` | No | `12` |

5. Deploy/redeploy and open **Deploy Logs**. Look for `Logged in as ...` and `Slash commands registered.`
6. Join a Discord VC, then run `/join` in your server. Speak a short sentence and wait for the bot to respond.
7. Use `/leave` when finished. Configure Railway's restart behavior and a paid plan if you need continuous availability; free/trial plans may have usage limits.

**Railway doesn't need a web domain or port for this bot.** It makes outbound Discord Gateway and OpenAI requests.

## 5. Run locally (optional)

Requires Node.js 22+, FFmpeg, a compiler for native Opus dependency, and an OpenAI API key.

```bash
cp .env.example .env
# Fill .env with actual secrets
npm install
npm start
```

Windows: manually copy `.env.example` to `.env` and edit it. Docker is recommended for consistent dependencies.

## Troubleshooting

- **`Missing DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `OPENAI_API_KEY`:** Check Railway service Variables and redeploy.
- **`Used disallowed intents`:** Only Guilds and GuildVoiceStates are requested; verify your code has not added privileged intents.
- **Slash commands missing:** Check `DISCORD_CLIENT_ID`, `GUILD_ID`, bot installation scopes, and deploy logs.
- **Bot joins but no audio:** Check `Connect`/`Speak` permissions, Discord voice receiving support, server's voice connection, and logs. The bot deliberately uses `selfDeaf: false` to receive audio.
- **Voice connection / encryption errors:** Make sure `@discordjs/voice` and `@discordjs/dave-protocol` install successfully. Discord voice encryption support evolves; update packages if Discord changes its voice protocol.
- **No reply / 401 / 429:** Verify OpenAI API key, billing, rate limits, and access to selected models.
- **Bot replies slowly:** Sequential transcription, chat, and TTS introduce latency; try shorter speech and smaller models.
- **`/join` disconnects:** Check voice permissions, region/connectivity, and deployment logs.
- **Other members interrupt:** Speech from several users may queue up; this version does not support barge-in or real-time duplex streaming.

## Security and privacy

- Use a private GitHub repo, Railway secret variables, and a limited-access OpenAI API key.
- Notify VC participants that audio is processed by OpenAI and may be logged as transcripts. Consider channel access restrictions and consent requirements.
- No persistent database; conversation history is stored in memory and lost on restart.
- This bot is not affiliated with Discord or OpenAI.

## Architecture

`Discord voice receive (Opus) → PCM WAV → OpenAI transcription → Chat completion → OpenAI TTS MP3 → Discord VC playback`

Each guild has one session. The audio processing queue is limited to four pending utterances, with user cooldowns and maximum utterance duration to reduce load. API calls incur usage charges. Review https://platform.openai.com/docs/ and https://platform.openai.com/pricing for current model availability and pricing.

## Railway E404 fix (v1.0.1)

Removed the invalid direct dependency `@discordjs/dave-protocol@^1.0.0`. This package is not published at that npm registry path. Upload the entire updated project to GitHub and redeploy Railway. If an old `package-lock.json` exists in your GitHub repository, delete it or regenerate it using `npm install` so it does not retain the removed dependency. This ZIP does not include a lockfile.
