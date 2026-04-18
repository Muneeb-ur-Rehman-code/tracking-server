const Database = require('better-sqlite3');
const db = new Database('tracking.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id    TEXT UNIQUE NOT NULL,
    fbclid      TEXT,
    fbp         TEXT,
    fbc         TEXT,
    utm_source  TEXT,
    utm_medium  TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS telegram_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    click_id    TEXT NOT NULL,
    mapped_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id    TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    amount      REAL,
    currency    TEXT DEFAULT 'USD',
    status      TEXT,
    raw_payload TEXT,
    capi_sent   INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS postback_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_query   TEXT,
    click_id    TEXT,
    matched     INTEGER DEFAULT 0,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;