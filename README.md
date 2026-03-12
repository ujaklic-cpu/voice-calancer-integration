# voice-calendar-integrator

Convert voice input (multilingual) → STT (Whisper) → AI (Copilot CLI / OpenAI) → Google Calendar → Multilingual TTS (Coqui TTS).

## Architecture

| Component | Role |
|---|---|
| `server.js` | Express API server (STT, AI, Calendar, TTS, OAuth endpoints) |
| `ai_adapter.js` | Copilot CLI subprocess wrapper with AJV validation, retries, and OpenAI fallback |
| `db/tokenStore.js` | SQLite token store for OAuth credentials |
| `db/schema.sql` | Database schema (tokens + event audit) |
| `public/index.html` | Frontend SPA (record → transcribe → parse → create → confirm) |
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

# 3. Run database migration
npm run migrate-db

# 4. Start with Docker Compose (recommended)
docker-compose up --build

# — or — start the server directly
npm start
```

### Frontend
Open `http://localhost:3000/` in your browser.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/stt` | Audio file → `{ text, language, confidence }` |
| `POST` | `/api/ai` | `{ text, lang }` → structured event JSON (AJV-validated) |
| `POST` | `/api/calendar` | Event + `userId` → create Google Calendar event |
| `POST` | `/api/tts` | `{ text, lang, voice }` → `{ audioBase64, mimeType }` |
| `GET` | `/auth/url?userId=xxx` | Returns Google OAuth URL |
| `GET` | `/auth/callback` | OAuth callback — persists tokens for `userId` |

### Example: parse event with AI

```bash
curl -X POST http://localhost:3000/api/ai \
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
| `WHISPER_URL` | `http://whisper:9001` | Whisper STT service URL |
| `COQUI_TTS_URL` | `http://coqui-tts:5002` | Coqui TTS service URL |
| `TOKENS_DB_PATH` | `./data/tokens.db` | SQLite database path |
| `OPENAI_API_KEY` | _(optional)_ | OpenAI key — used as AI fallback |
| `COPILOT_TIMEOUT_MS` | `30000` | Timeout per Copilot CLI call |

## Development

```bash
npm run dev          # nodemon (auto-reload)
npm test             # Jest unit + integration tests
npm run migrate-db   # Apply DB schema
```

## Security

- HTTP security headers via **Helmet**
- Rate limiting on `/api/*` and `/auth/*` (express-rate-limit)
- CORS configurable via `CORS_ORIGIN` env var
- OAuth tokens stored in SQLite (encrypt at rest in production — use Vault or cloud secret manager)
- No secrets embedded in prompts or logs
- Non-root Docker user; multi-stage image

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:
1. Install deps
2. Run DB migration (non-fatal)
3. Run Jest tests
4. Build Docker image (main branch only)

