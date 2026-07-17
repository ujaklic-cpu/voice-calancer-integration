require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.TOKENS_DB_PATH || './data/tokens.db';
const schemaPath = path.join(__dirname, 'schema.sql');

const dbDir = path.dirname(path.resolve(dbPath));
fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(dbPath, err => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
  console.log('Opened database at', dbPath);
});

const sql = fs.readFileSync(schemaPath, 'utf8');

db.exec(sql, err => {
  if (err) {
    console.error('Migration failed:', err.message);
    db.close();
    process.exit(1);
  }
  console.log('Migration complete.');
  db.close();
});
