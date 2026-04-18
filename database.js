const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create database in current directory
const dbPath = path.join(__dirname, 'tracking.db');

// better-sqlite3 automatically creates the file if it doesn't exist
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables - IDEMPOTENT (safe to run multiple times)
try {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS telegram_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id   TEXT UNIQUE NOT NULL,
      click_id      TEXT NOT NULL UNIQUE,
      telegram_username TEXT,
      mapped_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(click_id) REFERENCES clicks(click_id)
    );

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

    CREATE TABLE IF NOT EXISTS postback_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_query     TEXT,
      click_id      TEXT,
      matched       INTEGER DEFAULT 0,
      error_msg     TEXT,
      http_status   INTEGER,
      received_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meta_capi_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      conversion_id INTEGER NOT NULL,
      event_id      TEXT UNIQUE,
      event_name    TEXT,
      user_data     TEXT,
      custom_data   TEXT,
      sent_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      status        TEXT DEFAULT 'pending',
      FOREIGN KEY(conversion_id) REFERENCES conversions(id)
    );
  `);

  console.log('✓ Database tables created successfully');
} catch (err) {
  console.error('✗ Database initialization error:', err.message);
  process.exit(1);
}

// Test database connection
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