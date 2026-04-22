const Database = require('better-sqlite3');
const path = require('path');

// ─── Create / Open Database ────────────────────────────────────
const dbPath = path.join(__dirname, 'tracking.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL'); // Better performance

// ─── Create Tables ─────────────────────────────────────────────
try {
  db.exec(`

    -- Table 1: Every landing page click
    CREATE TABLE IF NOT EXISTS clicks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      click_id      TEXT UNIQUE NOT NULL,
      fbclid        TEXT,
      fbp           TEXT,
      fbc           TEXT,
      utm_source    TEXT,
      utm_medium    TEXT,
      utm_campaign  TEXT,
      utm_content   TEXT,
      utm_term      TEXT,
      ip_address    TEXT,
      user_agent    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Table 2: Telegram user → click_id mapping
    CREATE TABLE IF NOT EXISTS telegram_users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id       TEXT UNIQUE NOT NULL,
      click_id          TEXT NOT NULL,
      telegram_username TEXT,
      first_name        TEXT,
      last_name         TEXT,
      mapped_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(click_id) REFERENCES clicks(click_id)
    );

    -- Table 3: Deposits / conversions from XM postback
    CREATE TABLE IF NOT EXISTS conversions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      click_id      TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      amount        REAL,
      currency      TEXT DEFAULT 'USD',
      status        TEXT,
      raw_payload   TEXT,
      capi_sent     INTEGER DEFAULT 0,
      capi_response TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(click_id) REFERENCES clicks(click_id)
    );

    -- Table 4: All postback requests log (even broken ones)
    CREATE TABLE IF NOT EXISTS postback_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_query   TEXT,
      click_id    TEXT,
      matched     INTEGER DEFAULT 0,
      error_msg   TEXT,
      http_status INTEGER,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Table 5: Meta CAPI events sent
    CREATE TABLE IF NOT EXISTS meta_capi_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      event_id      TEXT UNIQUE,
      event_name    TEXT,
      user_data     TEXT,
      custom_data   TEXT,
      sent_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      status        TEXT DEFAULT 'pending',
      response_body TEXT,
      FOREIGN KEY(conversion_id) REFERENCES conversions(id)
    );

    -- Table 6: Bot message log
    CREATE TABLE IF NOT EXISTS bot_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT,
      username    TEXT,
      message     TEXT,
      click_id    TEXT,
      action      TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

  `);

  console.log('✓ Database tables created successfully');

} catch (err) {
  console.error('✗ Database initialization error:', err.message);
  process.exit(1);
}

// ─── Verify Connection ─────────────────────────────────────────
try {
  const test = db.prepare('SELECT 1 as test').get();
  if (test.test === 1) {
    console.log('✓ Database connection verified');
  }
} catch (err) {
  console.error('✗ Database connection failed:', err.message);
  process.exit(1);
}

module.exports = db;