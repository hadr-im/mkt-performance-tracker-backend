/**
 * Local / long-running entry point.
 *
 * Vercel does not use this file — it imports the app through api/index.js and
 * runs it as a serverless function, where binding a port is neither needed
 * nor allowed.
 */
const app = require('./app');
const { SHEET_ID } = require('./services/sheets');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 AIESEC Dashboard Backend running on http://localhost:${PORT}`);
  console.log(`📊 Spreadsheet: ${SHEET_ID}`);
  console.log(`🌐 Allowed origins: ${app.ALLOWED_ORIGINS.join(', ')}`);
  if (!app.API_TOKEN) {
    console.warn('⚠️  API_TOKEN is not set — the API is open to anyone who can reach it.');
  }
});
