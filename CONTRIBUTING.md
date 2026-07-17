# Contributing

## Local setup

```bash
npm ci
cp .env.example .env
npm run migrate-db
npm run dev
```

Use Node.js 18 or newer. The server uses CommonJS modules and the existing ESLint configuration.

## Checks

Run these before submitting a change:

```bash
npm run lint
npm test
```

Tests must not depend on live Google, Copilot, OpenAI, Whisper, or TTS services. Mock external clients at their local module boundary. Cover both the successful path and relevant failure behavior for new endpoints and helpers.

For Android changes, also run the tasks used by CI:

```bash
gradle -p android :app:lint :app:assembleDebug :app:bundleRelease
```

Keep credentials, OAuth tokens, calendar data, and other personal information out of source, fixtures, and logs. Explain the reason for a change in the pull request and call out any check that could not be run locally.
