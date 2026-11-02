/**
 * Vercel serverless entry point.
 *
 * An Express app is itself an (req, res) handler, so exporting it is all the
 * Node runtime needs. vercel.json rewrites every path here, which keeps the
 * existing /api/* routes working unchanged.
 *
 * Note: each cold start gets a fresh in-memory cache, so the 60s sheet cache
 * is per-instance rather than global. With this traffic that only means a few
 * extra Google Sheets reads.
 */
module.exports = require('../app');
