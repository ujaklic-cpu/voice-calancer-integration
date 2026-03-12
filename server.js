// server.js — Express server wiring the main endpoints:
//   POST /api/stt       — audio → Whisper STT service
//   POST /api/ai        — text → AI adapter → structured event JSON (AJV-validated)
//   POST /api/calendar  — event + userId → Google Calendar
//   POST /api/tts       — text → Coqui TTS → audio base64
//   GET  /auth/url      — returns Google OAuth URL for a userId
//   GET  /auth/callback — exchanges OAuth code for tokens and persists them

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const { google } = require('googleapis');

const { callCopilotCli } = require('./ai_adapter');
const { saveTokens, loadTokens, saveEvent } = require('./db/tokenStore');

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(bodyParser.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9001';
const COQUI_TTS_URL = process.env.COQUI_TTS_URL || 'http://coqui-tts:5002';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/callback`
  );
}

async function ensureTokens(userId) {
  const tokens = await loadTokens(userId);
  if (!tokens) throw Object.assign(new Error('No tokens for user ' + userId), { status: 401 });

  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(tokens);

  // expiry_date from google-auth-library is in milliseconds (like Date.now()).
  // Refresh if the access token has expired (or will expire within 60 s).
  const expiryDate = tokens.expiry_date;
  if (expiryDate && expiryDate - Date.now() < 60000) {
    const { credentials } = await oAuth2Client.refreshAccessToken();
    await saveTokens(userId, credentials);
    oAuth2Client.setCredentials(credentials);
  }
  return oAuth2Client;
}

// ---------------------------------------------------------------------------
// POST /api/stt
// ---------------------------------------------------------------------------
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing audio file' });
  try {
    const r = await axios.post(`${WHISPER_URL}/transcribe`, req.file.buffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 120000
    });
    return res.json(r.data);
  } catch (err) {
    logger.error('STT error', { detail: err?.response?.data || err.message });
    return res.status(502).json({ error: 'STT upstream error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai
// ---------------------------------------------------------------------------
app.post('/api/ai', async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });
  try {
    const parsed = await callCopilotCli(text, lang || 'und');
    return res.json(parsed);
  } catch (err) {
    logger.error('AI adapter error', { detail: err.message, raw: err.rawOutput });
    return res.status(502).json({ error: 'AI adapter error', detail: err.message, raw: err.rawOutput });
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendar
// ---------------------------------------------------------------------------
app.post('/api/calendar', async (req, res) => {
  const event = req.body;
  if (!event || !event.title || !event.start) {
    return res.status(400).json({ error: 'invalid event: title and start are required' });
  }

  const userId = event.userId;
  if (!userId) return res.status(400).json({ error: 'missing userId' });

  try {
    const auth = await ensureTokens(userId);
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

    // Audit
    await saveEvent({
      id: uuidv4(),
      userId,
      raw_text: event.raw_text,
      parsed_json: event,
      calendar_event_id: created.data.id,
      status: 'created',
      created_at: Date.now()
    }).catch(e => logger.warn('Event audit save failed', { detail: e.message }));

    return res.status(201).json({ created: created.data });
  } catch (err) {
    if (err.status === 401) return res.status(401).json({ error: err.message });
    logger.error('Calendar error', { detail: err?.response?.data || err.message });
    return res.status(500).json({ error: 'calendar error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tts
// ---------------------------------------------------------------------------
app.post('/api/tts', async (req, res) => {
  const { text, lang, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'missing text' });
  try {
    const r = await axios.post(
      `${COQUI_TTS_URL}/synthesize`,
      { text, lang, voice },
      { responseType: 'arraybuffer', timeout: 120000 }
    );
    const audioBase64 = Buffer.from(r.data).toString('base64');
    return res.json({ audioBase64, mimeType: r.headers['content-type'] || 'audio/wav' });
  } catch (err) {
    logger.error('TTS error', { detail: err?.response?.data || err.message });
    return res.status(502).json({ error: 'TTS upstream error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/url?userId=xxx  — returns Google OAuth URL
// ---------------------------------------------------------------------------
app.get('/auth/url', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'missing userId' });

  const oAuth2Client = createOAuth2Client();
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: userId,
    prompt: 'consent'
  });
  return res.json({ url });
});

// ---------------------------------------------------------------------------
// GET /auth/callback?code=...&state=...  — exchanges code for tokens
// ---------------------------------------------------------------------------
app.get('/auth/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).json({ error: 'missing code or state' });

  try {
    const oAuth2Client = createOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    await saveTokens(userId, tokens);
    logger.info('OAuth tokens saved', { userId });
    return res.json({ success: true, userId });
  } catch (err) {
    logger.error('OAuth callback error', { detail: err.message });
    return res.status(500).json({ error: 'OAuth error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

let server;
if (require.main === module) {
  server = app.listen(PORT, () => logger.info(`server listening on ${PORT}`));
}

module.exports = { app };
