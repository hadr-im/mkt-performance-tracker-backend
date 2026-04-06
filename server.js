require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*', // For development flexibility, but usually restricted to process.env.FRONTEND_URL
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Routes
app.use('/api/overview', require('./routes/overview'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/universities', require('./routes/universities'));
app.use('/api/products', require('./routes/products'));
app.use('/api/members', require('./routes/members'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 AIESEC Dashboard Backend running on http://localhost:${PORT}`);
  console.log(`📊 API endpoints available at /api/overview, /api/departments, /api/universities, /api/products, /api/members`);
});
