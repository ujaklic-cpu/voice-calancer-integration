#!/usr/bin/env node
'use strict';
/**
 * scripts/init_db.js
 * Initialize (or migrate) the SQLite tokens database.
 * Run via: npm run migrate-db
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.TOKENS_DB_PATH || path.join(__dirname, '..', 'data', 'tokens.db');

const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    user_id   TEXT PRIMARY KEY,
    tokens    TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )
`);

console.log(`Database initialized at ${DB_PATH}`);
db.close();
