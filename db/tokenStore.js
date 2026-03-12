// db/tokenStore.js — SQLite-backed token store for OAuth credentials.
// In production replace with Vault / cloud secret manager and encrypt tokens_json at rest.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.TOKENS_DB_PATH || './data/tokens.db';

let _db = null;

function getDb() {
  if (_db) return _db;
  const dbDir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dbDir, { recursive: true });
  _db = new sqlite3.Database(dbPath);
  return _db;
}

/**
 * Persist OAuth tokens for a user.
 * @param {string} userId
 * @param {object} tokens  — the tokens object from google-auth-library
 */
function saveTokens(userId, tokens) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    const now = Date.now();
    db.run(
      `INSERT INTO tokens (userId, tokens_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET tokens_json=excluded.tokens_json, updated_at=excluded.updated_at`,
      [userId, JSON.stringify(tokens), now],
      err => (err ? reject(err) : resolve())
    );
  });
}

/**
 * Load stored tokens for a user (returns null if not found).
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
function loadTokens(userId) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get('SELECT tokens_json FROM tokens WHERE userId = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      try {
        resolve(JSON.parse(row.tokens_json));
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Persist an event audit record.
 */
function saveEvent(eventRecord) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      `INSERT INTO events (id, userId, raw_text, parsed_json, calendar_event_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventRecord.id,
        eventRecord.userId,
        eventRecord.raw_text || null,
        eventRecord.parsed_json ? JSON.stringify(eventRecord.parsed_json) : null,
        eventRecord.calendar_event_id || null,
        eventRecord.status || 'pending',
        eventRecord.created_at || Date.now()
      ],
      err => (err ? reject(err) : resolve())
    );
  });
}

module.exports = { saveTokens, loadTokens, saveEvent };
