require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// HEALTH CHECK — confirm server is running
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Tracking server is running' });
});

// ─────────────────────────────────────────
// POSTBACK ENDPOINT — XM fires this on deposit
// URL: GET /postback?click_id={tag}&amount={deposit_amount}&event={status}
// ─────────────────────────────────────────
app.get('/postback', (req, res) => {
  const { click_id, amount, event, currency, txid } = req.query;

  // Log everything that comes in — even if broken
  db.prepare(`
    INSERT INTO postback_logs (raw_query, click_id, matched)
    VALUES (?, ?, ?)
  `).run(JSON.stringify(req.query), click_id || null, 0);

  // Validate — click_id is required
  if (!click_id) {
    console.log('[POSTBACK] Missing click_id — logged but not processed');
    return res.status(200).send('OK'); 
    // Always return 200 to XM — even on error
    // Otherwise XM thinks postback failed and retries
  }

  // Check if this click_id exists in our database
  const click = db.prepare(
    'SELECT * FROM clicks WHERE click_id = ?'
  ).get(click_id);

  if (!click) {
    console.log(`[POSTBACK] click_id not found: ${click_id}`);
    // Update log to show no match
    db.prepare(
      'UPDATE postback_logs SET matched = 0 WHERE click_id = ? ORDER BY id DESC LIMIT 1'
    ).run(click_id);
    return res.status(200).send('OK');
  }

  // click_id matched — save conversion
  db.prepare(`
    INSERT INTO conversions 
      (click_id, event_type, amount, currency, status, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    click_id,
    event    || 'deposit',
    amount   ? parseFloat(amount) : null,
    currency || 'USD',
    event    || 'FTD',
    JSON.stringify(req.query)
  );

  // Update log — matched
  db.prepare(
    'UPDATE postback_logs SET matched = 1 WHERE click_id = ? ORDER BY id DESC LIMIT 1'
  ).run(click_id);

  console.log(`[POSTBACK] Conversion saved — click_id: ${click_id}, amount: ${amount}, event: ${event}`);

  // Return 200 — this is what XM expects
  res.status(200).send('OK');
});

// ─────────────────────────────────────────
// TEST ENDPOINT — manually test postback
// URL: GET /test-postback?click_id=TEST123&amount=500&event=FTD
// ─────────────────────────────────────────
app.get('/test-postback', (req, res) => {
  const { click_id, amount, event } = req.query;

  // First insert a dummy click so test works
  try {
    db.prepare(`
      INSERT OR IGNORE INTO clicks (click_id, fbclid, utm_source)
      VALUES (?, 'TEST_FBCLID', 'test')
    `).run(click_id || 'TEST123');
  } catch(e) {}

  // Now hit the postback logic directly
  const result = {
    received: req.query,
    click_id_found: !!db.prepare('SELECT id FROM clicks WHERE click_id = ?').get(click_id || 'TEST123'),
    conversions_saved: db.prepare('SELECT COUNT(*) as c FROM conversions WHERE click_id = ?').get(click_id || 'TEST123').c,
    status: 'test_ok'
  };

  res.json(result);
});

// ─────────────────────────────────────────
// DASHBOARD DATA — view all conversions
// URL: GET /dashboard-data
// ─────────────────────────────────────────
app.get('/dashboard-data', (req, res) => {
  const conversions = db.prepare(`
    SELECT 
      c.click_id,
      c.event_type,
      c.amount,
      c.currency,
      c.status,
      c.capi_sent,
      c.created_at,
      cl.utm_campaign,
      cl.utm_content,
      cl.fbclid
    FROM conversions c
    LEFT JOIN clicks cl ON c.click_id = cl.click_id
    ORDER BY c.created_at DESC
    LIMIT 100
  `).all();

  const summary = db.prepare(`
    SELECT 
      COUNT(*) as total_conversions,
      SUM(amount) as total_amount,
      COUNT(DISTINCT click_id) as unique_users
    FROM conversions
    WHERE event_type = 'deposit' OR event_type = 'FTD'
  `).get();

  res.json({ summary, conversions });
});

// ─────────────────────────────────────────
// POSTBACK LOGS — debug view
// URL: GET /logs
// ─────────────────────────────────────────
app.get('/logs', (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM postback_logs ORDER BY received_at DESC LIMIT 50'
  ).all();
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`Tracking server running on port ${PORT}`);
});
