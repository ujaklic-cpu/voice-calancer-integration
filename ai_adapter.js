'use strict';
/**
 * ai_adapter.js
 * Hardened GitHub Copilot CLI adapter with:
 * - Per-call timeout
 * - Automatic retries with exponential back-off
 * - JSON schema validation of the response
 */

const { spawn } = require('child_process');

const MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES || '3', 10);
const CALL_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '30000', 10);
const BACKOFF_BASE_MS = 500;

const REQUIRED_KEYS = ['intent', 'title', 'start', 'end', 'timezone', 'attendees', 'reminders', 'language', 'raw_text'];

function buildPrompt(transcript, lang) {
  return `You are an assistant that MUST output exactly a single valid JSON object with the following keys:\n` +
    `intent, title, start, end, timezone, location, attendees (array), reminders (array of {method,minutes}), language, raw_text.\n` +
    `Use null or [] for missing fields. Use ISO8601 dates with timezone names.\n` +
    `Language hint: ${lang || 'und'}.\n` +
    `Utterance: """${transcript}"""\n` +
    `Output only the JSON object and nothing else.\n`;
}

function validateSchema(obj) {
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) throw new Error(`Missing required key in AI response: ${key}`);
  }
  if (!Array.isArray(obj.attendees)) throw new Error('attendees must be an array');
  if (!Array.isArray(obj.reminders)) throw new Error('reminders must be an array');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function invokeOnce(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('copilot', ['chat'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error(`Copilot CLI timed out after ${CALL_TIMEOUT_MS}ms`));
    }, CALL_TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return reject(new Error(`copilot exited ${code}: ${stderr.slice(0, 200)}`));

      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return reject(new Error('No JSON found in copilot output: ' + stdout.slice(0, 300)));

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (err) {
        return reject(new Error('Invalid JSON from copilot: ' + err.message));
      }

      try {
        validateSchema(parsed);
      } catch (err) {
        return reject(err);
      }

      resolve(parsed);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function callCopilotCli(transcript, lang) {
  const prompt = buildPrompt(transcript, lang);
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await invokeOnce(prompt);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

module.exports = { callCopilotCli };
