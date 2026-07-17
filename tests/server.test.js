const request = require('supertest');
const { app } = require('../server');

jest.mock('../ai_adapter', () => ({
  callCopilotCli: jest.fn()
}));

jest.mock('../db/tokenStore', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  loadTokens: jest.fn().mockResolvedValue(null),
  saveEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('axios');
const axios = require('axios');

const { callCopilotCli } = require('../ai_adapter');

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /auth/status', () => {
  it('returns authenticated=true when auth is disabled (no env vars set)', async () => {
    const res = await request(app).get('/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.authEnabled).toBe(false);
  });
});

describe('POST /auth/login', () => {
  it('returns success when auth is disabled', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'anyone', password: 'anything' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authEnabled).toBe(false);
  });

});

describe('POST /auth/logout', () => {
  it('returns success', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/stt', () => {
  it('returns 400 when no audio file provided', async () => {
    const res = await request(app).post('/api/stt');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing audio/i);
  });

  it('proxies audio to Whisper and returns transcript', async () => {
    axios.post.mockResolvedValueOnce({
      data: { text: 'Hello world', language: 'en', confidence: 0.97 }
    });
    const res = await request(app)
      .post('/api/stt')
      .attach('audio', Buffer.from('fake-audio'), 'test.webm');
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Hello world');
  });

  it('returns 502 on Whisper upstream error', async () => {
    axios.post.mockRejectedValueOnce(new Error('whisper down'));
    const res = await request(app)
      .post('/api/stt')
      .attach('audio', Buffer.from('fake-audio'), 'test.webm');
    expect(res.status).toBe(502);
  });
});

describe('POST /api/ai', () => {
  const VALID_EVENT = {
    intent: 'create_event', title: 'Meeting', start: '2026-03-13T10:00:00Z',
    end: '2026-03-13T11:00:00Z', timezone: 'UTC', location: null,
    attendees: [], reminders: [], language: 'en',
    raw_text: 'Meeting at 10am'
  };

  it('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/ai').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing text/i);
  });

  it('returns structured event from AI adapter', async () => {
    callCopilotCli.mockResolvedValueOnce(VALID_EVENT);
    const res = await request(app)
      .post('/api/ai')
      .send({ text: 'Meeting at 10am', lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Meeting');
  });

  it('uses local parser for Slovenian utterance without AI adapter call', async () => {
    callCopilotCli.mockClear();
    const res = await request(app)
      .post('/api/ai')
      .send({ text: 'Sestanek z Urbanom jutri ob devetih v Ljubljani', lang: 'sl' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Sestanek z Urbanom');
    expect(res.body.location).toBe('Ljubljani');
    expect(callCopilotCli).not.toHaveBeenCalled();
  });

  it('returns 502 when AI adapter throws', async () => {
    const err = new Error('AI failed');
    err.rawOutput = 'raw garbage';
    callCopilotCli.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/ai')
      .send({ text: 'something', lang: 'en' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/AI adapter error/i);
    expect(res.body).not.toHaveProperty('raw');
  });
});

describe('POST /api/tts', () => {
  it('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/tts').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing text/i);
  });

  it('returns base64 audio from TTS service', async () => {
    axios.post.mockResolvedValueOnce({
      data: Buffer.from('fake-audio-bytes'),
      headers: { 'content-type': 'audio/wav' }
    });
    const res = await request(app)
      .post('/api/tts')
      .send({ text: 'Hello', lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.audioBase64).toBeDefined();
    expect(res.body.mimeType).toBe('audio/wav');
  });

  it('returns 502 on TTS upstream error', async () => {
    axios.post.mockRejectedValueOnce(new Error('tts down'));
    const res = await request(app)
      .post('/api/tts')
      .send({ text: 'Hello', lang: 'en' });
    expect(res.status).toBe(502);
  });
});

describe('POST /api/calendar', () => {
  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/calendar')
      .send({ start: '2026-03-13T10:00:00Z', userId: 'u1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .post('/api/calendar')
      .send({ title: 'Test', start: '2026-03-13T10:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing userId/i);
  });

  it('returns 401 when no tokens exist for user', async () => {
    const { loadTokens } = require('../db/tokenStore');
    loadTokens.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/calendar')
      .send({ title: 'Meeting', start: '2026-03-13T10:00:00Z', userId: 'no-tokens-user' });
    expect(res.status).toBe(401);
  });

  it('rejects non-array attendees before calling Google Calendar', async () => {
    const { loadTokens } = require('../db/tokenStore');
    loadTokens.mockResolvedValueOnce({ access_token: 'test' });
    const res = await request(app)
      .post('/api/calendar')
      .send({ title: 'Meeting', start: '2026-03-13T10:00:00Z', userId: 'u1', attendees: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/url', () => {
  it('returns 400 when userId is missing', async () => {
    const res = await request(app).get('/auth/url');
    expect(res.status).toBe(400);
  });

  it('returns OAuth URL when userId is provided', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    const res = await request(app).get('/auth/url?userId=user123');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/accounts\.google\.com/);
  });
});

describe('OAuth state', () => {
  const { createOAuthState, verifyOAuthState } = require('../server');

  it('round-trips a signed user ID and rejects tampering', () => {
    const state = createOAuthState('user123', 1000);
    expect(verifyOAuthState(state, 1001)).toBe('user123');
    expect(verifyOAuthState(`${state}x`, 1001)).toBeNull();
  });

  it('rejects expired state', () => {
    const state = createOAuthState('user123', 1000);
    expect(verifyOAuthState(state, 1000 + 10 * 60 * 1000 + 1)).toBeNull();
  });
});
