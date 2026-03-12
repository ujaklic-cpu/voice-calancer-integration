# voice-calendar-integrator

Convert voice input (multilingual) or typed text → AI (Copilot CLI / OpenAI) → Google Calendar → Multilingual TTS (Coqui TTS).

## Architecture

| Component | Role |
|---|---|
| `server.js` | Express API server (Auth, STT, AI, Calendar, TTS, OAuth endpoints) |
| `ai_adapter.js` | Copilot CLI subprocess wrapper with AJV validation, retries, and OpenAI fallback |
| `db/tokenStore.js` | SQLite token store for OAuth credentials |
| `db/schema.sql` | Database schema (tokens + event audit) |
| `public/index.html` | Frontend SPA — dark mode UI with login wall, voice recording, and text input |
| `android/` | Android app — on-device STT, configurable server URL, login, text input |
| `Dockerfile` | Multi-stage production image (non-root user, health check) |
| `docker-compose.yml` | Dev stack (app, Whisper, Coqui TTS) |

## Quickstart (local)

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli/about-github-copilot-in-the-cli) installed & authenticated (optional — OpenAI fallback available)

### Setup

```bash
# 1. Install dependencies
npm ci

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and optionally OPENAI_API_KEY
# Set UI_USERNAME and UI_PASSWORD to enable the login wall

# 3. Run database migration
npm run migrate-db

# 4. Start with Docker Compose (recommended)
docker-compose up --build

# — or — start the server directly
npm start
```

### Frontend
Open `http://localhost:3000/` in your browser.

If `UI_USERNAME` and `UI_PASSWORD` are set, you will be prompted to sign in before accessing the app.

## UI Login Wall

Set `UI_USERNAME` and `UI_PASSWORD` in `.env` to enable simple username/password authentication on the web UI. When both variables are set:

- All `/api/*` endpoints and OAuth endpoints require an active session.
- `POST /auth/login` — exchange credentials for a session cookie.
- `POST /auth/logout` — destroy the session.
- `GET /auth/status` — returns `{ authenticated, authEnabled }`.

If either variable is empty, authentication is disabled (development mode).

## Text Input Option

The web UI and Android app both support a **Type** mode that skips the speech-to-text step entirely. Switch to **Type**, enter your event description, then click **Parse with AI**.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe — returns `{"status":"ok"}` |
| `POST` | `/auth/login` | Sign in with `{ username, password }` — returns session cookie |
| `POST` | `/auth/logout` | Destroy current session |
| `GET` | `/auth/status` | Returns `{ authenticated, authEnabled }` |
| `POST` | `/api/stt` | Audio file → `{ text, language, confidence }` _(auth required)_ |
| `POST` | `/api/ai` | `{ text, lang }` → structured event JSON _(auth required)_ |
| `POST` | `/api/calendar` | Event + `userId` → create Google Calendar event _(auth required)_ |
| `POST` | `/api/tts` | `{ text, lang, voice }` → `{ audioBase64, mimeType }` _(auth required)_ |
| `GET` | `/auth/url?userId=xxx` | Returns Google OAuth URL _(auth required)_ |
| `GET` | `/auth/callback` | OAuth callback — persists tokens for `userId` _(auth required)_ |

### Example: parse event with AI

```bash
# Log in first (if auth is enabled)
TOKEN=$(curl -s -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"secret"}')

curl -b cookies.txt -X POST http://localhost:3000/api/ai \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remind me to call Ana tomorrow at 9am for 30 minutes","lang":"en"}'
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | _(required)_ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | _(required)_ | Google OAuth client secret |
| `BASE_URL` | `http://localhost:3000` | Public URL (used for OAuth redirect) |
| `UI_USERNAME` | _(empty = disabled)_ | Web UI login username |
| `UI_PASSWORD` | _(empty = disabled)_ | Web UI login password |
| `SESSION_SECRET` | _(auto-generated)_ | Express session secret — set a stable value in production |
| `WHISPER_URL` | `http://whisper:9001` | Whisper STT service URL |
| `COQUI_TTS_URL` | `http://coqui-tts:5002` | Coqui TTS service URL |
| `TOKENS_DB_PATH` | `./data/tokens.db` | SQLite database path |
| `OPENAI_API_KEY` | _(optional)_ | OpenAI key — used as AI fallback |
| `COPILOT_TIMEOUT_MS` | `30000` | Timeout per Copilot CLI call |

## Android App

Located in `android/`. Built with Kotlin and the Material Components library.

### Features

- **On-device speech recognition** via Android's built-in `SpeechRecognizer` — no Whisper service or VPN needed.
- **Text input mode** — type an event description and send it directly to the AI.
- **Configurable server URL** — point the app at any reachable server (local, LAN, or internet).
- **Login screen** — authenticates against the server's login wall.
- **On-device TTS** — speaks the confirmation using Android's `TextToSpeech` engine.

### Build & Install

Requirements: Android Studio (Electric Eel or later), Android SDK 26+.

```bash
cd android
./gradlew assembleDebug
# APK will be in app/build/outputs/apk/debug/
```

Or open the `android/` folder in Android Studio and click **Run**.

### First-time setup

1. Open the app and enter your **Server URL** (the public URL of your server, e.g. `https://voice.example.com`).
2. Enter your **Username** and **Password** to sign in.
3. On the main screen, tap **Authorize Google Calendar** if you haven't connected your Google account yet.
4. Choose **Voice** or **Type** mode, describe your event, then tap **Parse with AI** and **Create Calendar Event**.

## Development

```bash
npm run dev          # nodemon (auto-reload)
npm test             # Jest unit + integration tests
npm run lint         # ESLint
npm run migrate-db   # Apply DB schema
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

## Security

- HTTP security headers via **Helmet**
- Rate limiting on `/api/*` and `/auth/*` (express-rate-limit)
- CORS configurable via `CORS_ORIGIN` env var
- Simple username/password login wall — credentials stored in environment variables, not in the codebase
- Sessions managed by `express-session` with `httpOnly`, `sameSite=lax` cookies
- Timing-safe credential comparison (`crypto.timingSafeEqual`)
- OAuth tokens stored in SQLite (encrypt at rest in production — use Vault or cloud secret manager)
- No secrets embedded in prompts or logs
- Non-root Docker user; multi-stage image

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:
1. Install deps
2. Run DB migration (non-fatal)
3. Run Jest tests
4. Build Docker image (main branch only)

