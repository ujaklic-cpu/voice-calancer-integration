# Deployment Notes — Voice Calendar Integrator

## Prerequisites

- Docker ≥ 20, Docker Compose ≥ 2
- A Google Cloud project with the Calendar API enabled and OAuth 2.0 credentials
- Copilot CLI installed and authenticated (for the ai-adapter container)
- Whisper inference server (e.g. `openai/whisper` wrapped with a small REST server)
- Coqui TTS inference server

---

## 1. Environment Setup

Copy `.env.example` to `.env` and fill in all values:

```
GOOGLE_CLIENT_ID=<your OAuth client ID>
GOOGLE_CLIENT_SECRET=<your OAuth client secret>
BASE_URL=https://your-domain.com          # or http://localhost:3000 for local dev
WHISPER_URL=http://whisper:9001
COQUI_TTS_URL=http://coqui-tts:5002
PORT=3000
TOKENS_DB_PATH=/app/data/tokens.db        # optional; default: data/tokens.db
```

> **Never commit `.env`** — it is in `.gitignore`.

---

## 2. Google OAuth Configuration

1. In Google Cloud Console → APIs & Services → Credentials, add an Authorised Redirect URI:
   ```
   <BASE_URL>/auth/callback
   ```
2. Download the client-secret JSON (optional); copy the Client ID and Secret to `.env`.

---

## 3. Database Initialisation

Run the migration once before starting the server:

```bash
npm run migrate-db
# or inside Docker:
docker-compose run --rm app npm run migrate-db
```

This creates `data/tokens.db` (or `TOKENS_DB_PATH`) with the `tokens` table.

---

## 4. Starting with Docker Compose

```bash
docker-compose up --build
```

Services started:
| Service   | Port  | Description                         |
|-----------|-------|-------------------------------------|
| app       | 3000  | Main Express server + frontend      |
| ai-adapter| 4000  | Copilot CLI adapter (internal only) |
| whisper   | 9001  | Whisper STT inference server        |
| coqui-tts | 5002  | Coqui TTS inference server          |

---

## 5. Testing Endpoints

```bash
# Health check
curl http://localhost:3000/

# Get OAuth redirect URL
curl "http://localhost:3000/auth/url?userId=default"

# STT (provide a WAV file)
curl -F "audio=@sample.wav" http://localhost:3000/api/stt

# AI parsing
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{"text":"Meeting with Ana tomorrow at 10am for 1 hour","lang":"en"}'

# TTS
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Event created","lang":"en"}' | jq .audioBase64 | base64 -d > out.wav
```

---

## 6. Security Notes

- Tokens DB contains OAuth refresh tokens. In production, **encrypt the database at rest** or use a secrets manager.
- The `ai-adapter` container requires the Copilot CLI binary — either build it into the image or bind-mount the host binary and its config directory (e.g. `~/.config/github-copilot`).
- Set strict firewall rules so that `ai-adapter`, `whisper`, and `coqui-tts` are not exposed publicly.
