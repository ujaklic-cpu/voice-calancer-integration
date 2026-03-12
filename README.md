# voice-calendar-integrator

A small integration that captures voice/text (multilingual), performs STT (Whisper), sends the text to an AI adapter (Copilot CLI / GPT-5 mini), creates or updates Google Calendar events, and returns multilingual TTS audio (Coqui TTS).

Status: Prototype / experimental

## Table of contents
- <a>Goals</a>
- <a>Features</a>
- <a>Architecture</a>
- <a>Prerequisites</a>
- <a>Quickstart (local)</a>
- <a>Configuration (.env)</a>
- <a>API endpoints</a>
- <a>Security</a>
- <a>Development notes</a>
- <a>Contributing</a>
- <a>License</a>
- <a>Contact</a>

## Goals
- Capture voice/text (multilingual)
- Speech-to-text (Whisper)
- AI processing (Copilot CLI / GPT-5 mini) to interpret intent and create/update events
- Google Calendar integration
- Multilingual text-to-speech (Coqui TTS)

## Features
- Local-first, containerized stack using Docker Compose
- Pluggable STT and TTS services via HTTP endpoints
- AI adapter component (ai-adapter) uses Copilot CLI on the host for advanced reasoning
- Minimal API to orchestrate STT → AI → Calendar → TTS flow

## Architecture
- Frontend (not included / optional): capture audio or text and call API endpoints
- Backend:
  - server.js: exposes API endpoints
  - ai_adapter.js: integrates with Copilot CLI or remote AI
  - Integrations: Whisper (STT), Coqui TTS, Google Calendar API

## Prerequisites
- Node.js 18+ (for local dev tools if needed)
- Docker &amp; Docker Compose
- gh (optional, for GitHub operations)
- Copilot CLI installed &amp; authenticated on the host running the ai-adapter (Copilot credentials are NOT stored in this repo)

## Quickstart (local)
1. Clone the repository:
   - git clone https://github.com/ujaklic-cpu/voice-calancer-integration.git
   - cd voice-calancer-integration

2. Create a `.env` file (see `.env.example`) and set required variables (example below).

3. Build and start with Docker Compose:
   - docker-compose up --build

   This will build and run the services defined in docker-compose.

4. Test endpoints (examples below) from frontend, Postman, or curl:
   - /api/stt — submit audio for transcription
   - /api/ai — send text to AI adapter for intent parsing/calendar actions
   - /api/tts — request TTS audio output

## Configuration (.env)
Create `.env` based on `.env.example`. Minimum environment variables used by the server:

- GOOGLE_CLIENT_ID — OAuth Client ID for Google API
- GOOGLE_CLIENT_SECRET — OAuth Client Secret
- COQUI_TTS_URL — HTTP URL for Coqui TTS (e.g., http://localhost:5002)
- WHISPER_URL — HTTP URL for Whisper STT service (e.g., http://localhost:9001)
- PORT — (optional) port for the server (default commonly 3000)

Important: Do not commit `.env` to source control.

## API endpoints (examples)
Note: adjust host/port to match your Docker Compose setup.

- POST /api/stt
  - Description: upload audio to be transcribed by Whisper.
  - Example (curl multipart/form-data):
    curl -X POST "http://localhost:3000/api/stt" -F "file=@/path/to/audio.wav"

- POST /api/ai
  - Description: send text to AI adapter for parsing intent / calendar changes.
  - Example:
    curl -X POST "http://localhost:3000/api/ai" -H "Content-Type: application/json" -d '{"text":"Schedule a meeting tomorrow at 10am with Alice"}'

- POST /api/tts
  - Description: request TTS audio output (Coqui).
  - Example:
    curl -X POST "http://localhost:3000/api/tts" -H "Content-Type: application/json" -d '{"text":"Event created", "voice":"alloy", "lang":"en"}' --output out.wav

If the repo contains additional endpoints or parameters, check server.js for details.

## Security
- Keep OAuth credentials secret. Do not commit `.env` to git.
- Copilot CLI must be authenticated on the host that runs the ai-adapter; we do not store Copilot credentials in the repo.
- Use least-privilege OAuth scopes for Google Calendar.
- If exposing any endpoints publicly, enable authentication (not provided in this prototype).

## Development notes
- See `server.js` and `ai_adapter.js` for endpoint implementations and integration points.
- ai-adapter expects Copilot CLI available in PATH on the host (not in container) if configured that way — check code comments and environment for configuration options.
- To change STT/TTS providers, update the WHISPER_URL or COQUI_TTS_URL configuration and adapt request payloads in `server.js`.

## Contributing
- Open issues with reproduction steps and desired behavior.
- For code changes: create a feature branch, add tests where possible, and open a pull request.
- Follow repository coding style and include small, focused commits.

## License
- Add license file if desired (e.g., MIT). This repo currently does not include a LICENSE file — add one if you plan to publish.

## Contact
- Repo owner: ujaklic-cpu
- For questions or help, open an issue in this repository.
