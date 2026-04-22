require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const db         = require('./database');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Config ────────────────────────────────────────────────────
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL    = process.env.WEBHOOK_URL || 'https://track.dilpreetbrar.com/bot/webhook';
const CHANNEL_INVITE = process.env.TELEGRAM_CHANNEL_INVITE || 'https://t.me/+w5hA-IgvFNAzYjkx';
const XM_BASE_URL    = process.env.XM_BASE_URL || 'https://clicks.pipaffiliates.com/c?c=1063319&l=en&p=1';

// ─── Telegram Bot (Webhook Mode — NO polling) ──────────────────
let bot = null;

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN); // No { polling: true } here!
  console.log('✓ Telegram Bot instance created (webhook mode)');
} else {
  console.log('⚠ TELEGRAM_BOT_TOKEN not set — bot disabled');
}

// ─── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()),
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} — IP: ${req.ip}`);
  next();
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 1 — HEALTH CHECK
// GET /
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      status:    'ok',
      message:   'Dilpreet FX Tracking Server is running',
      database:  'connected',
      bot:       bot ? 'configured' : 'not configured',
      timestamp: new Date().toISOString(),
      endpoints: {
        health:        'GET /',
        click:         'POST /api/click',
        telegramMap:   'POST /api/telegram-map',
        botWebhook:    'POST /bot/webhook',
        postback:      'GET /postback',
        testPostback:  'GET /test-postback',
        dashboardData: 'GET /dashboard-data',
        stats:         'GET /stats',
        logs:          'GET /logs'
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 2 — REGISTER CLICK
// POST /api/click
// Called by: Landing page JavaScript
// ═══════════════════════════════════════════════════════════════
app.post('/api/click', (req, res) => {
  try {
    const {
      click_id,
      fbclid, fbp, fbc,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      ip_address, user_agent
    } = req.body;

    if (!click_id) {
      return res.status(400).json({ error: 'Missing required field: click_id' });
    }

    db.prepare(`
      INSERT INTO clicks (
        click_id, fbclid, fbp, fbc,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      click_id,
      fbclid       || null,
      fbp          || null,
      fbc          || null,
      utm_source   || null,
      utm_medium   || null,
      utm_campaign || null,
      utm_content  || null,
      utm_term     || null,
      ip_address   || req.ip,
      user_agent   || req.get('User-Agent')
    );

    console.log(`✓ Click registered: ${click_id} | fbclid: ${fbclid || 'none'} | campaign: ${utm_campaign || 'none'}`);

    res.status(201).json({
      status:   'ok',
      message:  'Click registered',
      click_id: click_id
    });

  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Click ID already exists', click_id: req.body.click_id });
    }
    console.error('✗ Click registration error:', err.message);
    res.status(500).json({ error: 'Failed to register click', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 3 — TELEGRAM USER MAPPING
// POST /api/telegram-map
// Called by: Bot handler (internal, inside same server)
// ═══════════════════════════════════════════════════════════════
app.post('/api/telegram-map', (req, res) => {
  try {
    const { telegram_id, click_id, telegram_username, first_name, last_name } = req.body;

    if (!telegram_id || !click_id) {
      return res.status(400).json({ error: 'Missing required fields: telegram_id, click_id' });
    }

    // Verify click exists
    const click = db.prepare('SELECT id FROM clicks WHERE click_id = ?').get(click_id);
    if (!click) {
      return res.status(404).json({ error: 'Click ID not found', click_id });
    }

    db.prepare(`
      INSERT INTO telegram_users (telegram_id, click_id, telegram_username, first_name, last_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      telegram_id,
      click_id,
      telegram_username || null,
      first_name        || null,
      last_name         || null
    );

    console.log(`✓ Telegram mapped: ${telegram_id} (${telegram_username || 'no username'}) → ${click_id}`);

    res.status(201).json({
      status:      'ok',
      message:     'Telegram user mapped',
      telegram_id: telegram_id,
      click_id:    click_id
    });

  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Telegram user already mapped', telegram_id: req.body.telegram_id });
    }
    console.error('✗ Telegram mapping error:', err.message);
    res.status(500).json({ error: 'Failed to map telegram user', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 4 — TELEGRAM BOT WEBHOOK
// POST /bot/webhook
// Called by: Telegram servers (when user messages the bot)
// ═══════════════════════════════════════════════════════════════
app.post('/bot/webhook', async (req, res) => {

  // Always respond 200 to Telegram immediately
  res.status(200).send('OK');

  if (!bot) {
    console.log('[WEBHOOK] Bot not configured — skipping');
    return;
  }

  try {
    const update = req.body;
    console.log('[WEBHOOK] Update received:', JSON.stringify(update));

    // Let node-telegram-bot-api process the update
    bot.processUpdate(update);

  } catch (err) {
    console.error('[WEBHOOK] Error processing update:', err.message);
  }
});

// ─── Bot: Handle /start command ────────────────────────────────
if (bot) {

  bot.onText(/\/start(.*)/, async (msg, match) => {

    const chatId     = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const username   = msg.from.username  || null;
    const firstName  = msg.from.first_name || '';
    const lastName   = msg.from.last_name  || '';

    // Extract click_id from /start <click_id>
    const startParam = match[1].trim();
    const click_id   = startParam || null;

    console.log(`[BOT] /start from ${telegramId} (@${username}) — click_id: ${click_id}`);

    // Log to bot_logs table
    try {
      db.prepare(`
        INSERT INTO bot_logs (telegram_id, username, message, click_id, action)
        VALUES (?, ?, ?, ?, ?)
      `).run(telegramId, username, msg.text, click_id, 'start');
    } catch (e) {
      // Non-critical — don't stop flow
    }

    // ── Case 1: No click_id — user opened bot directly ──────────
    if (!click_id) {
      return bot.sendMessage(chatId,
        '⚠️ *Invalid link*\n\n' +
        'Please use the button on our website to get started correctly.',
        { parse_mode: 'Markdown' }
      );
    }

    // ── Case 2: Valid click_id — process user ───────────────────
    try {

      // Check click exists in DB
      const click = db.prepare('SELECT * FROM clicks WHERE click_id = ?').get(click_id);

      if (!click) {
        console.log(`[BOT] ✗ click_id not found in DB: ${click_id}`);
        // Still send links — don't block the user
        // (click might not have saved due to network issue)
      }

      // Save mapping (ignore if already mapped)
      try {
        db.prepare(`
          INSERT INTO telegram_users (telegram_id, click_id, telegram_username, first_name, last_name)
          VALUES (?, ?, ?, ?, ?)
        `).run(telegramId, click_id, username, firstName, lastName);

        console.log(`[BOT] ✓ New mapping saved: ${telegramId} → ${click_id}`);

      } catch (err) {
        if (err.message.includes('UNIQUE constraint')) {
          console.log(`[BOT] ℹ User ${telegramId} already mapped — sending links again`);
        } else {
          console.error(`[BOT] ✗ Mapping error: ${err.message}`);
        }
      }

      // Build XM link with click_id injected as tag
      const xmLink = `${XM_BASE_URL}&tag=${click_id}`;

      // Send welcome message with buttons
      await bot.sendMessage(chatId,
        `✅ *Welcome to Dilpreet FX Community, ${firstName}!*\n\n` +
        `Follow these simple steps to get started:\n\n` +
        `1️⃣ *Join our channel* for daily signals & analysis\n` +
        `2️⃣ *Open your XM account* using the button below\n` +
        `3️⃣ Make your first deposit & start trading\n\n` +
        `💬 Our team is here to guide you every step of the way!`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📲 Join Our Channel', url: CHANNEL_INVITE }
              ],
              [
                { text: '💰 Open XM Trading Account', url: xmLink }
              ]
            ]
          }
        }
      );

      console.log(`[BOT] ✓ Welcome message sent to ${telegramId}`);

    } catch (err) {
      console.error(`[BOT] ✗ Error in /start handler: ${err.message}`);

      // Graceful fallback — always send links even if DB fails
      const xmLink = `${XM_BASE_URL}&tag=${click_id}`;
      await bot.sendMessage(chatId,
        `✅ Welcome!\n\nClick below to get started:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📲 Join Our Channel', url: CHANNEL_INVITE }],
              [{ text: '💰 Open XM Account',  url: xmLink }]
            ]
          }
        }
      );
    }
  });

  // ─── Bot: Handle any other message ───────────────────────────
  bot.on('message', (msg) => {
    // Skip /start messages — already handled above
    if (msg.text && msg.text.startsWith('/start')) return;

    bot.sendMessage(msg.chat.id,
      '👋 Please use the link from our website to get started.\n\n' +
      'If you have any issues, contact our support team.'
    );
  });

  // ─── Bot: Handle polling errors (just in case) ────────────────
  bot.on('error', (err) => {
    console.error('[BOT] Error:', err.message);
  });

}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 5 — XM POSTBACK RECEIVER
// GET /postback?click_id=xxx&amount=xxx&event=FTD
// Called by: XM affiliate system when deposit happens
// ═══════════════════════════════════════════════════════════════
app.get('/postback', (req, res) => {
  try {
    const { click_id, amount, event, currency, status, txid } = req.query;

    console.log(`[POSTBACK] Received: ${JSON.stringify(req.query)}`);

    // Always log — even if broken
    const logPostback = (httpStatus, errorMsg = null, matched = 0) => {
      try {
        db.prepare(`
          INSERT INTO postback_logs (raw_query, click_id, matched, error_msg, http_status)
          VALUES (?, ?, ?, ?, ?)
        `).run(JSON.stringify(req.query), click_id || null, matched, errorMsg, httpStatus);
      } catch (e) {
        console.error('[POSTBACK] Log error:', e.message);
      }
    };

    // Validate click_id
    if (!click_id) {
      logPostback(400, 'Missing click_id');
      console.log('[POSTBACK] ✗ Missing click_id');
      return res.status(200).send('OK'); // Always 200 to XM
    }

    // Find click in DB
    const click = db.prepare('SELECT * FROM clicks WHERE click_id = ?').get(click_id);

    if (!click) {
      logPostback(404, `click_id not found: ${click_id}`);
      console.log(`[POSTBACK] ✗ click_id not found: ${click_id}`);
      return res.status(200).send('OK');
    }

    // Save conversion
    const result = db.prepare(`
      INSERT INTO conversions (click_id, event_type, amount, currency, status, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      click_id,
      event    || 'deposit',
      amount   ? parseFloat(amount) : null,
      currency || 'USD',
      status   || 'confirmed',
      JSON.stringify(req.query)
    );

    logPostback(200, null, 1);

    console.log(`[POSTBACK] ✓ Conversion saved — ID: ${result.lastInsertRowid} | click_id: ${click_id} | amount: ${amount} | event: ${event}`);

    // TODO: Add Meta CAPI forwarding here (Phase 3)

    return res.status(200).send('OK');

  } catch (err) {
    console.error('[POSTBACK] ✗ Error:', err.message);
    return res.status(200).send('OK'); // Always 200 to XM
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 6 — TEST POSTBACK (Manual Testing)
// GET /test-postback?click_id=TEST123&amount=500&event=FTD
// ═══════════════════════════════════════════════════════════════
app.get('/test-postback', (req, res) => {
  try {
    const { click_id, amount, event } = req.query;
    const testClickId = click_id || 'TEST_CLICK_001';

    // Create dummy click if doesn't exist
    try {
      db.prepare(`
        INSERT OR IGNORE INTO clicks (click_id, fbclid, utm_source, utm_campaign)
        VALUES (?, 'TEST_FBCLID_123', 'test', 'test-campaign')
      `).run(testClickId);
    } catch (e) { /* ignore */ }

    // Save conversion
    try {
      db.prepare(`
        INSERT INTO conversions (click_id, event_type, amount, currency, status, raw_payload)
        VALUES (?, ?, ?, 'USD', 'test', ?)
      `).run(
        testClickId,
        event  || 'FTD',
        amount ? parseFloat(amount) : 500,
        JSON.stringify(req.query)
      );
    } catch (e) { /* ignore */ }

    const clickExists   = !!db.prepare('SELECT id FROM clicks WHERE click_id = ?').get(testClickId);
    const convCount     = db.prepare('SELECT COUNT(*) as c FROM conversions WHERE click_id = ?').get(testClickId).c;
    const telegramMapped = !!db.prepare('SELECT id FROM telegram_users WHERE click_id = ?').get(testClickId);

    res.json({
      status:          'test_ok',
      test_click_id:   testClickId,
      click_exists:    clickExists,
      conversions:     convCount,
      telegram_mapped: telegramMapped,
      received_params: req.query
    });

  } catch (err) {
    res.status(500).json({ error: 'Test failed', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 7 — DASHBOARD DATA
// GET /dashboard-data
// ═══════════════════════════════════════════════════════════════
app.get('/dashboard-data', (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*)                                                               AS total_clicks,
        COUNT(DISTINCT tu.telegram_id)                                         AS total_telegram_users,
        SUM(CASE WHEN co.event_type IN ('deposit','FTD') THEN 1 ELSE 0 END)   AS total_deposits,
        SUM(CASE WHEN co.event_type IN ('deposit','FTD') THEN co.amount ELSE 0 END) AS total_amount,
        AVG(CASE WHEN co.event_type IN ('deposit','FTD') THEN co.amount ELSE NULL END) AS avg_deposit,
        COUNT(CASE WHEN co.capi_sent = 1 THEN 1 ELSE NULL END)                AS capi_sent_count
      FROM clicks cl
      LEFT JOIN telegram_users tu ON cl.click_id = tu.click_id
      LEFT JOIN conversions co    ON cl.click_id = co.click_id
    `).get();

    const conversions = db.prepare(`
      SELECT
        co.id,
        co.click_id,
        co.event_type,
        co.amount,
        co.currency,
        co.status,
        co.capi_sent,
        co.created_at,
        cl.utm_campaign,
        cl.utm_source,
        cl.utm_content,
        cl.fbclid,
        tu.telegram_username,
        tu.first_name
      FROM conversions co
      LEFT JOIN clicks         cl ON co.click_id = cl.click_id
      LEFT JOIN telegram_users tu ON co.click_id = tu.click_id
      ORDER BY co.created_at DESC
      LIMIT 100
    `).all();

    const recentClicks = db.prepare(`
      SELECT
        cl.click_id,
        cl.fbclid,
        cl.utm_source,
        cl.utm_campaign,
        cl.created_at,
        tu.telegram_username,
        tu.mapped_at
      FROM clicks cl
      LEFT JOIN telegram_users tu ON cl.click_id = tu.click_id
      ORDER BY cl.created_at DESC
      LIMIT 50
    `).all();

    res.json({
      summary,
      conversions,
      recent_clicks: recentClicks,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('✗ Dashboard error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dashboard data', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 8 — STATS
// GET /stats
// ═══════════════════════════════════════════════════════════════
app.get('/stats', (req, res) => {
  try {
    res.json({
      clicks:         db.prepare('SELECT COUNT(*) as c FROM clicks').get().c,
      telegram_users: db.prepare('SELECT COUNT(*) as c FROM telegram_users').get().c,
      conversions:    db.prepare('SELECT COUNT(*) as c FROM conversions').get().c,
      postback_logs:  db.prepare('SELECT COUNT(*) as c FROM postback_logs').get().c,
      bot_logs:       db.prepare('SELECT COUNT(*) as c FROM bot_logs').get().c,
      uptime_seconds: Math.round(process.uptime()),
      memory_mb:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node_version:   process.version,
      environment:    process.env.NODE_ENV || 'development',
      bot_status:     bot ? 'active' : 'disabled',
      timestamp:      new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 9 — LOGS (Debug)
// GET /logs
// ═══════════════════════════════════════════════════════════════
app.get('/logs', (req, res) => {
  try {
    const postbackLogs = db.prepare(`
      SELECT * FROM postback_logs ORDER BY received_at DESC LIMIT 100
    `).all();

    const botLogs = db.prepare(`
      SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT 100
    `).all();

    res.json({
      postback_logs: { count: postbackLogs.length, data: postbackLogs },
      bot_logs:      { count: botLogs.length,      data: botLogs      },
      timestamp:     new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 10 — SET WEBHOOK MANUALLY
// GET /set-webhook
// Hit this URL once after deployment to register webhook with Telegram
// ═══════════════════════════════════════════════════════════════
app.get('/set-webhook', async (req, res) => {
  if (!bot) {
    return res.status(400).json({ error: 'Bot not configured' });
  }

  try {
    await bot.setWebHook(WEBHOOK_URL);
    const info = await bot.getWebHookInfo();

    console.log('[WEBHOOK] ✓ Webhook set:', WEBHOOK_URL);

    res.json({
      status:       'ok',
      message:      'Webhook set successfully',
      webhook_url:  WEBHOOK_URL,
      webhook_info: info
    });
  } catch (err) {
    console.error('[WEBHOOK] ✗ Failed to set webhook:', err.message);
    res.status(500).json({ error: 'Failed to set webhook', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT 11 — CHECK WEBHOOK STATUS
// GET /webhook-status
// ═══════════════════════════════════════════════════════════════
app.get('/webhook-status', async (req, res) => {
  if (!bot) {
    return res.status(400).json({ error: 'Bot not configured' });
  }

  try {
    const info = await bot.getWebHookInfo();
    res.json({ status: 'ok', webhook_info: info });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get webhook info', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method });
});

// 500
app.use((err, req, res, next) => {
  console.error('✗ Unhandled error:', err);
  res.status(500).json({
    error:   'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
const server = app.listen(PORT, async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        DILPREET FX TRACKING SERVER STARTED           ║');
  console.log(`║        Port:    ${PORT}                                    ║`);
  console.log(`║        Mode:    ${(process.env.NODE_ENV || 'development').padEnd(12)}                    ║`);
  console.log('║        Domain:  track.dilpreetbrar.com               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // Auto-set webhook in production
  if (bot && process.env.NODE_ENV === 'production') {
    try {
      console.log('[BOT] Setting webhook...');
      await bot.setWebHook(WEBHOOK_URL);
      const info = await bot.getWebHookInfo();
      console.log(`[BOT] ✓ Webhook active: ${info.url}`);
    } catch (err) {
      console.error('[BOT] ✗ Webhook setup failed:', err.message);
      console.log('[BOT] ℹ You can set it manually by visiting: /set-webhook');
    }
  } else if (!bot) {
    console.log('[BOT] ⚠ Bot disabled — add TELEGRAM_BOT_TOKEN to .env');
  } else {
    console.log('[BOT] ℹ Development mode — visit /set-webhook to activate');
  }
});

// ─── Graceful Shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('\n[SERVER] SIGTERM received — shutting down gracefully');
  server.close(() => { console.log('[SERVER] Closed'); process.exit(0); });
});

process.on('SIGINT', () => {
  console.log('\n[SERVER] SIGINT received — shutting down gracefully');
  server.close(() => { console.log('[SERVER] Closed'); process.exit(0); });
});