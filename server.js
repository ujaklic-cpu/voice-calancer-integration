require('dotenv').config();

const express = require('express');
const axios = require('axios');
const multer = require('multer');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const { google } = require('googleapis');

const { callCopilotCli } = require('./ai_adapter');
const { parseLightweightEvent } = require('./light_parser');
const { saveTokens, loadTokens, saveEvent } = require('./db/tokenStore');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }
});
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(bodyParser.json({ limit: '1mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required when NODE_ENV=production');
}
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const UI_USERNAME = process.env.UI_USERNAME || '';
const UI_PASSWORD = process.env.UI_PASSWORD || '';
if (Boolean(UI_USERNAME) !== Boolean(UI_PASSWORD)) {
  throw new Error('UI_USERNAME and UI_PASSWORD must be configured together');
}
const AUTH_ENABLED = UI_USERNAME !== '' && UI_PASSWORD !== '';

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'authentication required' });
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const clientToken = req.headers['x-csrf-token'];
  const sessionToken = req.session && req.session.csrfToken;
  if (sessionToken && clientToken && safeEqual(clientToken, sessionToken)) return next();
  if (!AUTH_ENABLED && !sessionToken) {
    ensureCsrfToken(req);
    return next();
  }
  logger.warn('CSRF token mismatch');
  return res.status(403).json({ error: 'invalid or missing CSRF token' });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

// Serve frontend static files
app.use(express.static('public'));

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

app.use('/api/', requireAuth);
app.use('/auth/url', requireAuth);

app.use('/api/', verifyCsrf);

app.post('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ success: true, authEnabled: false });
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!safeEqual(username, UI_USERNAME) || !safeEqual(password, UI_PASSWORD)) {
    logger.warn('Failed login attempt');
    return res.status(401).json({ error: 'invalid credentials' });
  }
  req.session.authenticated = true;
  ensureCsrfToken(req);
  return res.json({ success: true, csrfToken: req.session.csrfToken });
});

app.post('/auth/logout', verifyCsrf, (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/auth/status', (req, res) => {
  const authenticated = !AUTH_ENABLED || !!(req.session && req.session.authenticated);
  return res.json({ authenticated, authEnabled: AUTH_ENABLED });
});

app.get('/auth/csrf-token', (req, res) => {
  const token = ensureCsrfToken(req);
  return res.json({ csrfToken: token });
});

const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:9001';
const COQUI_TTS_URL = process.env.COQUI_TTS_URL || 'http://coqui-tts:5002';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const USER_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function isValidUserId(userId) {
  return typeof userId === 'string' && USER_ID_RE.test(userId);
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/callback`
  );
}

function createOAuthState(userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: now + OAUTH_STATE_TTL_MS }))
    .toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyOAuthState(state, now = Date.now()) {
  if (typeof state !== 'string') return null;
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isValidUserId(decoded.userId) || !Number.isFinite(decoded.expiresAt) || decoded.expiresAt < now) {
      return null;
    }
    return decoded.userId;
  } catch (err) {
    return null;
  }
}

async function ensureTokens(userId) {
  const tokens = await loadTokens(userId);
  if (!tokens) throw Object.assign(new Error('No tokens for user ' + userId), { status: 401 });

  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(tokens);

  // Google token expiry values use Unix milliseconds.
  const expiryDate = tokens.expiry_date;
  if (expiryDate && expiryDate - Date.now() < 60000) {
    const { credentials } = await oAuth2Client.refreshAccessToken();
    await saveTokens(userId, credentials);
    oAuth2Client.setCredentials(credentials);
  }
  return oAuth2Client;
}

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

app.post('/api/ai', async (req, res) => {
  const { text, lang } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'missing text' });

  const localParsed = parseLightweightEvent(text, lang || 'und');
  if (localParsed) {
    return res.json(localParsed);
  }

  try {
    const parsed = await callCopilotCli(text, lang || 'und');
    return res.json(parsed);
  } catch (err) {
    logger.error('AI adapter error', { detail: err.message });
    return res.status(502).json({ error: 'AI adapter error' });
  }
});

app.post('/api/calendar', async (req, res) => {
  const event = req.body;
  if (!event || !event.title || !event.start) {
    return res.status(400).json({ error: 'invalid event: title and start are required' });
  }

  const userId = event.userId;
  if (!userId) return res.status(400).json({ error: 'missing userId' });
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'invalid userId' });
  if (event.attendees !== undefined && !Array.isArray(event.attendees)) {
    return res.status(400).json({ error: 'attendees must be an array' });
  }
  if (event.reminders !== undefined && !Array.isArray(event.reminders)) {
    return res.status(400).json({ error: 'reminders must be an array' });
  }

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

app.post('/api/tts', async (req, res) => {
  const { text, lang, voice } = req.body;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'missing text' });
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

app.get('/auth/url', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'missing userId' });
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'invalid userId' });

  const oAuth2Client = createOAuth2Client();
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: createOAuthState(userId),
    prompt: 'consent'
  });
  return res.json({ url });
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).json({ error: 'missing code or state' });
  const userId = verifyOAuthState(state);
  if (!userId) return res.status(400).json({ error: 'invalid or expired OAuth state' });

  try {
    const oAuth2Client = createOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    await saveTokens(userId, tokens);
    logger.info('OAuth tokens saved', { userId });
    return res.json({ success: true, userId });
  } catch (err) {
    logger.error('OAuth callback error', { detail: err.message });
    return res.status(502).json({ error: 'OAuth token exchange failed' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'audio file exceeds 25 MiB limit' });
    }
    return res.status(400).json({ error: 'invalid audio upload' });
  }
  return next(err);
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => logger.info(`server listening on ${PORT}`));
}

module.exports = { app, createOAuthState, verifyOAuthState };
