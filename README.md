# voice-calendar-integrator

Goal
- Capture voice/text (multilingual) → STT (Whisper) → AI (Copilot CLI / GPT-5 mini) → Google Calendar → Multilingual TTS (Coqui TTS).

Quickstart (local)
1. Install prerequisites:
   - Node.js 18+
   - Docker & Docker Compose
   - gh (optional, to create repo)
   - Copilot CLI installed & authenticated on the host running the ai-adapter
2. Create a .env file (see .env.example) with:
   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   - COQUI_TTS_URL (e.g., http://localhost:5002)
   - WHISPER_URL (e.g., http://localhost:9001)
3. Build & run:
   - docker-compose up --build
4. From the frontend (or Postman), call /api/stt /api/ai /api/tts as needed.

Security
- Keep OAuth credentials secret. Do not commit .env to git.
- Copilot CLI must be authenticated on the host that runs ai-adapter; we do not store Copilot credentials in repo.

See server.js and ai_adapter.js for endpoint and integration details.
