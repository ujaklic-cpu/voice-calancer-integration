// tests/ai_adapter.test.js — unit tests for ai_adapter helpers

const { extractAndValidate } = require('../ai_adapter');

const VALID_EVENT = {
  intent: 'create_event',
  title: 'Call Ana',
  start: '2026-03-13T09:00:00+01:00',
  end: '2026-03-13T09:30:00+01:00',
  timezone: 'Europe/Paris',
  location: null,
  attendees: ['ana@example.com'],
  reminders: [{ method: 'popup', minutes: 15 }],
  language: 'en',
  raw_text: 'Remind me to call Ana tomorrow at 9am for 30 minutes'
};

describe('extractAndValidate', () => {
  test('returns data for valid JSON event', () => {
    const raw = JSON.stringify(VALID_EVENT);
    const result = extractAndValidate(raw);
    expect(result.data).toBeDefined();
    expect(result.data.title).toBe('Call Ana');
  });

  test('returns data when JSON is embedded in prose', () => {
    const raw = 'Sure, here is the event:\n' + JSON.stringify(VALID_EVENT) + '\nHope that helps!';
    const result = extractAndValidate(raw);
    expect(result.data).toBeDefined();
    expect(result.data.intent).toBe('create_event');
  });

  test('returns error when no JSON found', () => {
    const result = extractAndValidate('no json here');
    expect(result.error).toMatch(/No JSON found/);
  });

  test('returns error for malformed JSON', () => {
    const result = extractAndValidate('{bad json}');
    expect(result.error).toMatch(/Invalid JSON/);
  });

  test('returns error when required field missing', () => {
    const { raw_text, ...incomplete } = VALID_EVENT;
    const result = extractAndValidate(JSON.stringify(incomplete));
    expect(result.error).toMatch(/Schema validation failed/);
  });

  test('returns error when attendees contain non-email', () => {
    const bad = { ...VALID_EVENT, attendees: ['not-an-email'] };
    const result = extractAndValidate(JSON.stringify(bad));
    expect(result.error).toMatch(/Schema validation failed/);
  });

  test('returns error when additionalProperties present', () => {
    const bad = { ...VALID_EVENT, extra: 'field' };
    const result = extractAndValidate(JSON.stringify(bad));
    expect(result.error).toMatch(/Schema validation failed/);
  });

  test('accepts null values for nullable fields', () => {
    const event = { ...VALID_EVENT, title: null, location: null };
    const result = extractAndValidate(JSON.stringify(event));
    expect(result.data).toBeDefined();
    expect(result.data.title).toBeNull();
  });
});
