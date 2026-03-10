// AI adapter that calls GitHub Copilot CLI (subprocess).
// It sends a strict system prompt and extracts the first JSON object in the output.
//
// Requirements:
// - copilot CLI installed and authenticated in the environment running this script.
// - Copilot configured to use GPT-5 mini (if available).
// - This script is synchronous-ish and expects the CLI to exit after responding.
//   You may need to adapt invocation flags for non-interactive behavior.

const { spawn } = require('child_process');

function buildPrompt(transcript, lang) {
  return `
You are an assistant that MUST output exactly a single valid JSON object with the following keys:
intent, title, start, end, timezone, location, attendees (array), reminders (array of {method,minutes}), language, raw_text.
Use null or [] for missing fields. Use ISO8601 dates with timezone names.
Language hint: ${lang || 'und'}.
Utterance: """${transcript}"""
Output only the JSON object and nothing else.
`;
}

async function callCopilotCli(transcript, lang) {
  const prompt = buildPrompt(transcript, lang);

  // Adjust the command/args as needed for your copilot CLI installation.
  const child = spawn('copilot', ['chat'], { stdio: ['pipe', 'pipe', 'inherit'] });

  return new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', chunk => stdout += chunk.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error('copilot exited ' + code));
      // Extract first JSON object
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return reject(new Error('No JSON found in copilot output: ' + stdout));
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return resolve(parsed);
      } catch (err) {
        return reject(new Error('Invalid JSON from copilot: ' + err.message + '\n' + jsonMatch[0]));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = { callCopilotCli };
