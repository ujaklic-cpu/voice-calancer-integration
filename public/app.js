'use strict';

const userId = 'default';

const btnAuth    = document.getElementById('btn-auth');
const authStatus = document.getElementById('auth-status');
const btnRecord  = document.getElementById('btn-record');
const transcript = document.getElementById('transcript');
const eventJson  = document.getElementById('event-json');
const btnCreate  = document.getElementById('btn-create');
const feedback   = document.getElementById('feedback');

let parsedEvent = null;
let mediaRecorder = null;
let audioChunks = [];

// ---- Auth ----
btnAuth.addEventListener('click', async () => {
  try {
    const res = await fetch(`/auth/url?userId=${encodeURIComponent(userId)}`);
    const { url } = await res.json();
    window.location.href = url;
  } catch (e) {
    showError('Could not get auth URL: ' + e.message);
  }
});

// Detect callback success via query param
if (new URLSearchParams(window.location.search).get('auth') === 'ok') {
  authStatus.textContent = '✓ Connected';
  btnRecord.disabled = false;
}

// ---- Record ----
btnRecord.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    btnRecord.textContent = '🎙 Record';
    return;
  }

  feedback.textContent = '';
  audioChunks = [];

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    showError('Microphone access denied: ' + e.message);
    return;
  }

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    await sendAudio(blob);
  };
  mediaRecorder.start();
  btnRecord.textContent = '⏹ Stop';
});

async function sendAudio(blob) {
  transcript.textContent = 'Transcribing…';
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');

  let sttData;
  try {
    const res = await fetch('/api/stt', { method: 'POST', body: form });
    sttData = await res.json();
  } catch (e) {
    showError('STT error: ' + e.message);
    return;
  }

  const text = sttData.text || '';
  transcript.textContent = text;
  if (!text) { showError('No speech detected'); return; }

  await sendToAI(text, sttData.language || 'und');
}

async function sendToAI(text, lang) {
  eventJson.textContent = 'Parsing…';
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
    });
    parsedEvent = await res.json();
    eventJson.textContent = JSON.stringify(parsedEvent, null, 2);
    btnCreate.disabled = false;
  } catch (e) {
    showError('AI error: ' + e.message);
  }
}

// ---- Create event ----
btnCreate.addEventListener('click', async () => {
  if (!parsedEvent) return;
  feedback.textContent = '';
  try {
    const res = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ userId }, parsedEvent)),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    feedback.style.color = '#27ae60';
    feedback.textContent = '✓ Event created: ' + (data.created?.id || 'ok');
    btnCreate.disabled = true;
  } catch (e) {
    showError('Calendar error: ' + e.message);
  }
});

function showError(msg) {
  feedback.style.color = '#c0392b';
  feedback.textContent = msg;
}
