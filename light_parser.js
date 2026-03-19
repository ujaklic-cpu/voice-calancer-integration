const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function buildIsoTomorrow(hour, minute = 0, baseDate = new Date()) {
  const dt = new Date(baseDate);
  dt.setDate(dt.getDate() + 1);
  dt.setHours(hour, minute, 0, 0);
  return dt.toISOString();
}

function parseSlovenian(text) {
  const normalized = text.trim();
  const match = normalized.match(
    /sestanek z\s+(.+?)\s+jutri\s+ob\s+(devetih|\d{1,2}(?::\d{2})?)\s+v\s+(.+)/i
  );
  if (!match) return null;

  const person = match[1].trim();
  const timeToken = match[2].toLowerCase();
  const location = match[3].trim().replace(/[.!,;:]$/, '');

  let hour = 9;
  let minute = 0;
  if (timeToken !== 'devetih') {
    const [h, m] = timeToken.split(':');
    hour = Number.parseInt(h, 10);
    minute = m ? Number.parseInt(m, 10) : 0;
  }
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const start = buildIsoTomorrow(hour, minute);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    intent: 'create_event',
    title: `Sestanek z ${person}`,
    start,
    end: end.toISOString(),
    timezone: TIMEZONE,
    location,
    attendees: [],
    reminders: [{ method: 'popup', minutes: 15 }],
    language: 'sl-SI',
    raw_text: text
  };
}

function parseEnglish(text, requestedLang = 'en-US') {
  const normalized = text.trim();
  const match = normalized.match(
    /meeting with\s+(.+?)\s+tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+in\s+(.+))?/i
  );
  if (!match) return null;

  const person = match[1].trim();
  let hour = Number.parseInt(match[2], 10);
  const minute = match[3] ? Number.parseInt(match[3], 10) : 0;
  const meridiem = (match[4] || '').toLowerCase();
  const location = (match[5] || '').trim().replace(/[.!,;:]$/, '') || null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const start = buildIsoTomorrow(hour, minute);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  const normalizedRequestedLang = requestedLang.toLowerCase();
  return {
    intent: 'create_event',
    title: `Meeting with ${person}`,
    start,
    end: end.toISOString(),
    timezone: TIMEZONE,
    location,
    attendees: [],
    reminders: [{ method: 'popup', minutes: 15 }],
    language: normalizedRequestedLang.startsWith('en-gb') ? 'en-GB' : 'en-US',
    raw_text: text
  };
}

function parseLightweightEvent(text, lang = 'und') {
  if (!text || typeof text !== 'string') return null;

  const normalizedLang = lang.toLowerCase();
  if (normalizedLang.startsWith('sl')) {
    return parseSlovenian(text);
  }
  if (normalizedLang.startsWith('en')) {
    return parseEnglish(text, normalizedLang);
  }

  return parseSlovenian(text) || parseEnglish(text);
}

module.exports = { parseLightweightEvent };
