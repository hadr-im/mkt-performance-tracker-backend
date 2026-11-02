require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { listTabs, getAvailability, SHEET_ID } = require('./services/sheets');

const app = express();

// Matches the PORT already configured in the deployment environment.
const PORT = process.env.PORT || 4000;

/**
 * Allowed browser origins, comma-separated in FRONTEND_URL, e.g.
 *   FRONTEND_URL=https://tracker.example.com,http://localhost:3000
 * Unset falls back to local development origins only.
 */
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Same-origin / server-side requests send no Origin header.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed: ${origin}`));
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

/**
 * Optional shared-secret gate. Enabled only when API_TOKEN is set, so an
 * existing deployment keeps working until the token is configured on both
 * sides.
 *
 * Note: this protects server-to-server calls. It is NOT a secret if the
 * browser sends it, because anything the browser holds is readable by the
 * user. To fully close off the API, proxy it through Next.js route handlers
 * and keep the token server-side only.
 */
const API_TOKEN = process.env.API_TOKEN;

app.use('/api', (req, res, next) => {
  if (!API_TOKEN) return next();
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health') return next();

  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const provided = bearer || req.get('x-api-key') || '';

  if (provided === API_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
});

// Routes
app.use('/api/overview', require('./routes/overview'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/universities', require('./routes/universities'));
app.use('/api/products', require('./routes/products'));
app.use('/api/members', require('./routes/members'));

// Health check — also reports what the spreadsheet actually provides,
// which makes a misconfigured sheet obvious without reading the logs.
app.get('/api/health', async (req, res) => {
  const body = { status: 'ok', timestamp: new Date().toISOString(), spreadsheetId: SHEET_ID };
  try {
    body.tabs = await listTabs();
    body.availability = await getAvailability();
  } catch (err) {
    body.status = 'degraded';
    body.error = err.message;
  }
  res.status(body.status === 'ok' ? 200 : 503).json(body);
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack || err.message);
  const status = /not allowed/i.test(err.message) ? 403 : 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error'
      : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 AIESEC Dashboard Backend running on http://localhost:${PORT}`);
  console.log(`📊 Spreadsheet: ${SHEET_ID}`);
  console.log(`🌐 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  if (!API_TOKEN) {
    console.warn('⚠️  API_TOKEN is not set — the API is open to anyone who can reach it.');
  }
});
