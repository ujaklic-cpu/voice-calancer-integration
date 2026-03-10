'use strict';
/**
 * server.js
 * Express server wiring all integration endpoints:
 * - GET  /auth/url          : returns Google OAuth redirect URL
 * - GET  /auth/callback     : handles OAuth callback, stores tokens
 * - POST /api/stt           : accepts audio file -> Whisper STT service
 * - POST /api/ai            : accepts { text, lang } -> ai_adapter -> structured JSON
 * - POST /api/calendar      : accepts event JSON -> Google Calendar API
 * - POST /api/tts           : accepts { text, lang } -> Coqui TTS -> base64 audio
 * - GET  /                  : serves static frontend (public/)
 */

const path = require('path');
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const bodyParser = require('body-parser');
const { callCopilotCli } = require('./ai_adapter');
const { google } = require('googleapis');
const { getAuthUrl, exchangeCode, saveTokens, getAuthenticatedClient } = require('./lib/oauth');

require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9001';
const COQUI_TTS_URL = process.env.COQUI_TTS_URL || 'http://coqui-tts:5002';

// ---- OAuth endpoints ----

// GET /auth/url?userId=<id>
// Returns a Google OAuth2 redirect URL for the given user.
app.get('/auth/url', (req, res) => {
  const userId = req.query.userId || 'default';
  try {
    const url = getAuthUrl(userId);
    return res.json({ url });
  } catch (err) {
    return res.status(500).json({ error: 'Could not build auth URL', detail: err.message });
  }
});

// GET /auth/callback?code=<code>&state=<userId>
// Exchanges the authorization code for tokens and stores them.
app.get('/auth/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');
  try {
    const tokens = await exchangeCode(code);
    saveTokens(userId || 'default', tokens);
    return res.redirect('/?auth=ok');
  } catch (err) {
    console.error('OAuth callback error', err.message);
    return res.status(500).send('OAuth error: ' + err.message);
  }
});

// ---- API endpoints ----

// POST /api/stt
// Receives audio file (multipart form: field name "audio") and proxies to Whisper service.
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing audio file' });
  try {
    const r = await axios.post(`${WHISPER_URL}/transcribe`, req.file.buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 120000
    });
    return res.json(r.data);
  } catch (err) {
    console.error('STT error', err?.response?.data || err.message);
    return res.status(500).json({ error: 'STT error', detail: err.message });
  }
});

// POST /api/ai
// Input: { text, lang }
// Returns: structured event JSON
app.post('/api/ai', async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });
  try {
    const parsed = await callCopilotCli(text, lang || 'und');
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'AI returned invalid JSON', raw: parsed });
    }
    return res.json(parsed);
  } catch (err) {
    console.error('AI adapter error', err);
    return res.status(500).json({ error: 'AI adapter error', detail: err.message });
  }
});

// POST /api/calendar
// Input: structured event JSON (userId required for token lookup)
app.post('/api/calendar', async (req, res) => {
  const event = req.body;
  if (!event || !event.title || !event.start) return res.status(400).json({ error: 'invalid event' });

  try {
    const userId = event.userId || 'default';
    const auth = await getAuthenticatedClient(userId);
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
