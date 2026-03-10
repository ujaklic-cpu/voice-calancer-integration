// Basic Express server wiring the main endpoints:
// - POST /api/stt       : accepts audio file (multipart/form-data) -> forwards to Whisper service
// - POST /api/ai        : accepts { text, lang } -> calls ai_adapter -> returns structured JSON
// - POST /api/calendar  : accepts event JSON -> uses googleapis to create/update event
// - POST /api/tts       : accepts { text, lang } -> calls Coqui TTS and returns audio as base64

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const bodyParser = require('body-parser');
const { callCopilotCli } = require('./ai_adapter');
const { google } = require('googleapis');

require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9001';
const COQUI_TTS_URL = process.env.COQUI_TTS_URL || 'http://coqui-tts:5002';

// POST /api/stt
// Receives audio file (multipart form: field name "audio") and proxies to a Whisper service.
// Adjust the target endpoint to whichever whisper server you run (whisper.cpp wrapper, custom Flask server, etc.)
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing audio file' });
  try {
    const r = await axios.post(`${WHISPER_URL}/transcribe`, req.file.buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 120000
    });
    // Expected response shape: { text, language, confidence }
    return res.json(r.data);
  } catch (err) {
    console.error('STT error', err?.response?.data || err.message);
    return res.status(500).json({ error: 'STT error', detail: err.message });
  }
});

// POST /api/ai
// Input: { text, lang }
// Returns: structured event JSON per contract
app.post('/api/ai', async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });
  try {
    const parsed = await callCopilotCli(text, lang || 'und');
    // Basic validation
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'AI returned invalid JSON', raw: parsed });
    }
    return res.json(parsed);
  } catch (err) {
    console.error('AI adapter error', err);
    return res.status(500).json({ error: 'AI adapter error', detail: err.message });
  }
});

// Utility: placeholder to get OAuth2 client for a user
function getOAuth2ClientForUser(userId) {
  // TODO: implement tokens store and refresh logic.
  // For now this returns an unauthenticated client; calling calendar API will fail until you set credentials.
  const oAuth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  // Load stored tokens for userId and call oAuth2Client.setCredentials(tokens)
  return oAuth2Client;
}

// POST /api/calendar
// Input: structured event JSON (see contract)
app.post('/api/calendar', async (req, res) => {
  const event = req.body;
  if (!event || !event.title || !event.start) return res.status(400).json({ error: 'invalid event' });

  try {
    const userId = req.body.userId || 'default';
    const auth = getOAuth2ClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    const eventBody = {
      summary: event.title,
      location: event.location || undefined,
      description: event.raw_text || undefined,
      start: { dateTime: event.start, timeZone: event.timezone || 'UTC' },
      end: { dateTime: event.end || event.start, timeZone: event.timezone || 'UTC' },
      attendees: (event.attendees || []).map(email => ({ email })),
      reminders: {
        useDefault: false,
        overrides: (event.reminders || []).map(r => ({ method: r.method, minutes: r.minutes }))
      }
    };

    const created = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
    return res.json({ created: created.data });
  } catch (err) {
    console.error('Calendar error', err?.response?.data || err.message);
    return res.status(500).json({ error: 'calendar error', detail: err.message });
  }
});

// POST /api/tts
// Input: { text, lang, voice } -> returns audio as base64 and mimeType
app.post('/api/tts', async (req, res) => {
  const { text, lang, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });
  try {
    // Example Coqui TTS REST endpoint; adjust according to chosen inference server
    const r = await axios.post(`${COQUI_TTS_URL}/synthesize`, { text, lang, voice }, { responseType: 'arraybuffer', timeout: 120000 });
    const audioBase64 = Buffer.from(r.data).toString('base64');
    return res.json({ audioBase64, mimeType: r.headers['content-type'] || 'audio/wav' });
  } catch (err) {
    console.error('TTS error', err?.response?.data || err.message);
    return res.status(500).json({ error: 'tts error', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`server listening on ${PORT}`));
