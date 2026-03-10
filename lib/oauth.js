'use strict';
/**
 * lib/oauth.js
 * SQLite-backed token store and Google OAuth2 helpers.
 */

const path = require('path');
const { google } = require('googleapis');
const Database = require('better-sqlite3');

const DB_PATH = process.env.TOKENS_DB_PATH || path.join(__dirname, '..', 'data', 'tokens.db');

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        user_id   TEXT PRIMARY KEY,
        tokens    TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )
    `);
  }
  return _db;
}

function saveTokens(userId, tokens) {
  const db = getDb();
  db.prepare(`
    INSERT INTO tokens (user_id, tokens, updated_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(user_id) DO UPDATE SET tokens=excluded.tokens, updated_at=excluded.updated_at
  `).run(userId, JSON.stringify(tokens));
}

function loadTokens(userId) {
  const db = getDb();
  const row = db.prepare('SELECT tokens FROM tokens WHERE user_id = ?').get(userId);
  return row ? JSON.parse(row.tokens) : null;
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL || 'http://localhost:3000'}/auth/callback`
  );
}

function getAuthUrl(userId) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: userId,
  });
}

async function exchangeCode(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function getAuthenticatedClient(userId) {
  const tokens = loadTokens(userId);
  if (!tokens) throw new Error(`No tokens found for user: ${userId}`);
  const client = createOAuth2Client();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    const merged = Object.assign({}, tokens, newTokens);
    saveTokens(userId, merged);
  });
  return client;
}

module.exports = { saveTokens, loadTokens, getAuthUrl, exchangeCode, getAuthenticatedClient };
