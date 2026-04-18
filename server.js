require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['https://track.app.dilpreetbrar.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// ═══════════════════════════════════════════════════════════════
// 1. HEALTH CHECK ENDPOINT
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  try {
    const dbTest = db.prepare('SELECT 1 as test').get();
    res.json({ 
      status: 'ok', 
      message: 'Tracking server is running',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Database connection failed',
      error: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. REGISTER CLICK ENDPOINT
// Used by landing page to register a new click with fbclid, UTMs, etc.
// POST /api/click
// Body: { click_id, fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content }
// ═══════════════════════════════════════════════════════════════
app.post('/api/click', (req, res) => {
  try {
    const { 
      click_id, fbclid, fbp, fbc, 
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      ip_address, user_agent 
    } = req.body;

    // Validate required field
    if (!click_id) {
      return res.status(400).json({ 
        error: 'Missing required field: click_id' 
      });
    }

    // Insert click record
    const stmt = db.prepare(`
      INSERT INTO clicks (
        click_id, fbclid, fbp, fbc, 
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      click_id, fbclid || null, fbp || null, fbc || null,
      utm_source || null, utm_medium || null, utm_campaign || null, 
      utm_content || null, utm_term || null,
      ip_address || req.ip, user_agent || req.get('User-Agent')
    );

    console.log(`✓ Click registered: ${click_id}`);

    res.status(201).json({ 
      status: 'ok', 
      message: 'Click registered',
      click_id: click_id 
    });
  } catch (err) {
    // Handle duplicate click_id
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ 
        error: 'Click ID already exists',
        click_id: req.body.click_id 
      });
    }
    
    console.error('✗ Click registration error:', err.message);
    res.status(500).json({ 
      error: 'Failed to register click',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 3. TELEGRAM USER MAPPING ENDPOINT
// Used by Telegram bot to map user to click_id
// POST /api/telegram-map
// Body: { telegram_id, click_id, telegram_username }
// ═══════════════════════════════════════════════════════════════
app.post('/api/telegram-map', (req, res) => {
  try {
    const { telegram_id, click_id, telegram_username } = req.body;

    if (!telegram_id || !click_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: telegram_id, click_id' 
      });
    }

    // Verify click exists
    const click = db.prepare('SELECT id FROM clicks WHERE click_id = ?').get(click_id);
    if (!click) {
      return res.status(404).json({ 
        error: 'Click ID not found',
        click_id: click_id 
      });
    }

    // Insert telegram mapping
    const stmt = db.prepare(`
      INSERT INTO telegram_users (telegram_id, click_id, telegram_username)
      VALUES (?, ?, ?)
    `);

    stmt.run(telegram_id, click_id, telegram_username || null);

    console.log(`✓ Telegram user mapped: ${telegram_id} → ${click_id}`);

    res.status(201).json({ 
      status: 'ok', 
      message: 'Telegram user mapped',
      telegram_id: telegram_id,
      click_id: click_id 
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ 
        error: 'Telegram user already mapped',
        telegram_id: req.body.telegram_id 
      });
    }

    console.error('✗ Telegram mapping error:', err.message);
    res.status(500).json({ 
      error: 'Failed to map telegram user',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. POSTBACK ENDPOINT (FROM XM)
// XM fires this URL when deposit happens
// GET /postback?click_id={tag}&amount={deposit_amount}&event={status}
// ═══════════════════════════════════════════════════════════════
app.get('/postback', (req, res) => {
  try {
    const { click_id, amount, event, currency, txid, status } = req.query;

    // Always log the postback - even if broken
    const logStmt = db.prepare(`
      INSERT INTO postback_logs (raw_query, click_id, http_status)
      VALUES (?, ?, ?)
    `);

    // Validate click_id
    if (!click_id) {
      logStmt.run(JSON.stringify(req.query), null, 400);
      console.log('[POSTBACK] ✗ Missing click_id — logged but not processed');
      // Return 200 anyway - XM expects success
      return res.status(200).send('OK');
    }

    // Check if click_id exists
    const click = db.prepare('SELECT * FROM clicks WHERE click_id = ?').get(click_id);

    if (!click) {
      logStmt.run(JSON.stringify(req.query), click_id, 404);
      console.log(`[POSTBACK] ✗ click_id not found: ${click_id}`);
      return res.status(200).send('OK');
    }

    // click_id exists - save conversion
    const convStmt = db.prepare(`
      INSERT INTO conversions (click_id, event_type, amount, currency, status, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    convStmt.run(
      click_id,
      event || 'deposit',
      amount ? parseFloat(amount) : null,
      currency || 'USD',
      status || 'pending',
      JSON.stringify(req.query)
    );

    // Update log - success
    logStmt.run(JSON.stringify(req.query), click_id, 200);

    console.log(`[POSTBACK] ✓ Conversion saved — click_id: ${click_id}, amount: ${amount}, event: ${event}`);

    // Return 200 - this is what XM expects
    res.status(200).send('OK');

  } catch (err) {
    console.error('[POSTBACK] ✗ Error processing postback:', err.message);
    // Still return 200 to XM - don't let server errors cause retries
    res.status(200).send('OK');
  }
});

// ═══════════════════════════════════════════════════════════════
// 5. TEST POSTBACK ENDPOINT
// For manual testing before XM integration
// GET /test-postback?click_id=TEST123&amount=500&event=FTD
// ═══════════════════════════════════════════════════════════════
app.get('/test-postback', (req, res) => {
  try {
    const { click_id, amount, event } = req.query;
    const testId = click_id || 'TEST123';

    // Create dummy click if doesn't exist
    try {
      db.prepare(`
        INSERT OR IGNORE INTO clicks (click_id, fbclid, utm_source)
        VALUES (?, 'TEST_FBCLID', 'test')
      `).run(testId);
    } catch (e) {
      // Ignore duplicate errors
    }

    // Now fire postback
    const conversion = db.prepare('SELECT id FROM conversions WHERE click_id = ?').get(testId);
    
    res.json({
      received: req.query,
      click_id_found: !!db.prepare('SELECT id FROM clicks WHERE click_id = ?').get(testId),
      conversions_count: db.prepare('SELECT COUNT(*) as c FROM conversions WHERE click_id = ?').get(testId).c,
      last_conversion_id: conversion?.id || null,
      status: 'test_ok'
    });

  } catch (err) {
    res.status(500).json({
      error: 'Test failed',
      message: err.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 6. DASHBOARD DATA ENDPOINT
// GET /dashboard-data
// Returns summary and recent conversions
// ═══════════════════════════════════════════════════════════════
app.get('/dashboard-data', (req, res) => {
  try {
    const conversions = db.prepare(`
      SELECT 
        c.id,
        c.click_id,
        c.event_type,
        c.amount,
        c.currency,
        c.status,
        c.capi_sent,
        c.created_at,
        cl.utm_campaign,
        cl.utm_content,
        cl.utm_source,
        cl.fbclid
      FROM conversions c
      LEFT JOIN clicks cl ON c.click_id = cl.click_id
      ORDER BY c.created_at DESC
      LIMIT 100
    `).all();

    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_conversions,
        COUNT(DISTINCT click_id) as unique_users,
        SUM(CASE WHEN event_type = 'deposit' OR event_type = 'FTD' THEN 1 ELSE 0 END) as total_deposits,
        SUM(CASE WHEN event_type = 'deposit' OR event_type = 'FTD' THEN amount ELSE 0 END) as total_amount,
        AVG(CASE WHEN event_type = 'deposit' OR event_type = 'FTD' THEN amount ELSE NULL END) as avg_deposit,
        COUNT(CASE WHEN capi_sent = 1 THEN 1 ELSE NULL END) as capi_sent_count
      FROM conversions
    `).get();

    res.json({ 
      summary, 
      conversions,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('✗ Dashboard data error:', err.message);
    res.status(500).json({ 
      error: 'Failed to fetch dashboard data',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 7. POSTBACK LOGS ENDPOINT (Debug)
// GET /logs
// Returns recent postback logs
// ═══════════════════════════════════════════════════════════════
app.get('/logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT * FROM postback_logs 
      ORDER BY received_at DESC 
      LIMIT 100
    `).all();

    res.json({ logs, count: logs.length });

  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to fetch logs',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 8. STATS ENDPOINT
// GET /stats
// Returns server and database statistics
// ═══════════════════════════════════════════════════════════════
app.get('/stats', (req, res) => {
  try {
    const stats = {
      clicks: db.prepare('SELECT COUNT(*) as count FROM clicks').get().count,
      telegram_users: db.prepare('SELECT COUNT(*) as count FROM telegram_users').get().count,
      conversions: db.prepare('SELECT COUNT(*) as count FROM conversions').get().count,
      postback_logs: db.prepare('SELECT COUNT(*) as count FROM postback_logs').get().count,
      uptime_seconds: process.uptime(),
      memory_usage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      timestamp: new Date().toISOString()
    };

    res.json(stats);

  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to fetch stats',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('✗ Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     TRACKING SERVER STARTED                          ║');
  console.log(`║     Port: ${PORT}                                           ║`);
  console.log(`║     Environment: ${process.env.NODE_ENV || 'development'}                      ║`);
  console.log('║     Health: http://localhost:' + PORT + '/                ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n✓ SIGTERM received - shutting down gracefully');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n✓ SIGINT received - shutting down gracefully');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});