// AI adapter — calls GitHub Copilot CLI (primary) or OpenAI API (fallback).
// Features:
//   • Strict AJV schema validation of the AI output.
//   • Exponential-backoff retries (up to MAX_RETRIES attempts).
//   • Configurable per-call timeout (COPILOT_TIMEOUT_MS); kills the child process on timeout.
//   • Falls back to OpenAI when Copilot CLI is unavailable and OPENAI_API_KEY is set.
//   • Sensitive data is never embedded in prompts.

require('dotenv').config();
const { spawn } = require('child_process');
const axios = require('axios');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// ---------------------------------------------------------------------------
// AJV schema — matches the aiEvent contract from the problem statement.
// ---------------------------------------------------------------------------
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const aiEventSchema = {
  $id: 'aiEvent',
  type: 'object',
  required: ['intent', 'title', 'start', 'end', 'timezone', 'language', 'raw_text'],
  properties: {
    intent: { type: 'string' },
    title: { type: ['string', 'null'] },
    start: { type: ['string', 'null'] },
    end: { type: ['string', 'null'] },
    timezone: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    attendees: { type: 'array', items: { type: 'string', format: 'email' } },
    reminders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['popup', 'email'] },
          minutes: { type: 'number' }
        },
        required: ['method', 'minutes']
      }
    },
    language: { type: 'string' },
    raw_text: { type: 'string' }
  },
  additionalProperties: false
};

const validateAiEvent = ajv.compile(aiEventSchema);

// ---------------------------------------------------------------------------
// Prompt builder — no secrets embedded.
// ---------------------------------------------------------------------------
function buildPrompt(transcript, lang) {
  return (
    'You are an assistant that MUST output exactly a single valid JSON object with the following keys:\n' +
    'intent, title, start, end, timezone, location, attendees (array of email strings), ' +
    'reminders (array of {method: "popup"|"email", minutes: number}), language, raw_text.\n' +
    'Use null or [] for missing fields. Use ISO 8601 dates with timezone offset.\n' +
    `Language hint: ${lang || 'und'}.\n` +
    `Utterance: """${transcript}"""\n` +
    'Output only the JSON object and nothing else.'
  );
}

// ---------------------------------------------------------------------------
// Extract + validate JSON from a raw string.
// Returns { data } on success or { error, raw } on failure.
// ---------------------------------------------------------------------------
function extractAndValidate(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { error: 'No JSON found in output', raw };
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { error: 'Invalid JSON: ' + e.message, raw: jsonMatch[0] };
  }
  const valid = validateAiEvent(parsed);
  if (!valid) {
    return { error: 'Schema validation failed: ' + ajv.errorsText(validateAiEvent.errors), raw: parsed };
  }
  return { data: parsed };
}

// ---------------------------------------------------------------------------
// Copilot CLI call — spawns `copilot chat` and feeds the prompt via stdin.
// ---------------------------------------------------------------------------
const COPILOT_TIMEOUT_MS = parseInt(process.env.COPILOT_TIMEOUT_MS || '30000', 10);

function callCopilotOnce(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('copilot', ['chat'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`Copilot CLI timed out after ${COPILOT_TIMEOUT_MS}ms`));
    }, COPILOT_TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return reject(new Error('copilot exited with code ' + code));
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// OpenAI fallback — used when Copilot CLI is unavailable.
// ---------------------------------------------------------------------------
async function callOpenAiFallback(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set; no LLM fallback available');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: COPILOT_TIMEOUT_MS
    }
  );
  return response.data.choices[0].message.content;
}

// ---------------------------------------------------------------------------
// Main export — with exponential-backoff retries.
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;

async function callCopilotCli(transcript, lang) {
  const prompt = buildPrompt(transcript, lang);
  let lastError;
  let useFallback = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let raw;
      if (useFallback) {
        raw = await callOpenAiFallback(prompt);
      } else {
        raw = await callCopilotOnce(prompt);
      }

      const result = extractAndValidate(raw);
      if (result.data) return result.data;
      lastError = new Error(result.error);
      lastError.rawOutput = result.raw;
    } catch (err) {
      lastError = err;
      // If Copilot CLI binary is not available, switch to OpenAI fallback immediately.
      if (!useFallback && (err.code === 'ENOENT' || /not found|no such file/i.test(err.message))) {
        useFallback = true;
      }
    }

    if (attempt < MAX_RETRIES) {
      const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1s, 2s
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const err = new Error('AI adapter failed after ' + MAX_RETRIES + ' attempts: ' + lastError.message);
  err.rawOutput = lastError.rawOutput;
  throw err;
}

module.exports = { callCopilotCli, extractAndValidate, validateAiEvent, aiEventSchema };

