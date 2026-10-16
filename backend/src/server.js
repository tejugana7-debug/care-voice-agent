// ==========================================
// Care Voice Agent - Express Backend Server
// ==========================================

// 1. Load environment variables from a .env file (if present) into process.env
const dotenv = require('dotenv');
dotenv.config();

// 2. Import required packages
const express = require('express');
const cors = require('cors');

// 3. Import database connection pool
const pool = require('./config/db');

// 4. Import route modules
const doctorsRouter = require('./routes/doctors');
const availabilityRouter = require('./routes/availability');
const appointmentsRouter = require('./routes/appointments');
const retellRouter = require('./routes/retell');

// 4. Initialize the Express application
const app = express();

// 5. Configure port (fallback to 5000 if not set in environment variables)
const PORT = process.env.PORT || 5000;

// ==========================================
// Middleware Configuration
// ==========================================

// Enable Cross-Origin Resource Sharing (CORS) so your frontend/client can communicate with this API
app.use(cors());

// Enable automatic parsing of incoming requests with JSON payloads (req.body)
app.use(express.json());

// ==========================================
// Helper Functions
// ==========================================

/**
 * Strips database credentials and full connection strings from error messages
 * to prevent leaking secrets in server logs.
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return 'Unknown database error';
  return String(msg)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/password\s*=\s*[^\s]+/gi, 'password=[REDACTED]');
}

// ==========================================
// API Routes
// ==========================================

/**
 * Health check endpoint: GET /api/health
 * Used to verify that the backend server is up and responsive.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Care Voice Agent server is running successfully',
    timestamp: new Date().toISOString()
  });
});

/**
 * Database health check endpoint: GET /api/db-health
 * Tests connection to the Supabase PostgreSQL database using SELECT 1.
 * Never exposes credentials, passwords, or the connection URL.
 */
app.get('/api/db-health', async (req, res) => {
  // Check if DATABASE_URL is provided in environment variables
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    return res.status(503).json({
      status: 'error',
      message: 'Database connection failed: DATABASE_URL is not configured in .env',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const startTime = Date.now();

    // Run a minimal query to verify database connectivity
    const result = await pool.query('SELECT 1 AS is_healthy;');
    const responseTimeMs = Date.now() - startTime;

    return res.status(200).json({
      status: 'ok',
      message: 'PostgreSQL database connection is healthy',
      database: 'connected',
      responseTimeMs,
      result: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Log sanitized error message without exposing connection details or passwords
    console.error('[DB Health Check Failed]:', sanitizeErrorMessage(error.message));

    return res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      code: error.code || 'DB_CONNECTION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

// Optional root route for quick browser testing
app.get('/', (req, res) => {
  res.send('Care Voice Agent API is online. Check /api/health for system status.');
});

// ==========================================
// Mount Routers
// ==========================================

// All doctor routes under /api/doctors
app.use('/api/doctors', doctorsRouter);

// All availability routes under /api/availability
app.use('/api/availability', availabilityRouter);

// Appointment booking under /api/appointments
app.use('/api/appointments', appointmentsRouter);

// Retell tools under /api/retell/tools
app.use('/api/retell/tools', retellRouter);

// ==========================================
// Start Server
// ==========================================
app.listen(PORT, () => {
  console.log(`[Server] Doctor Appointment Voice Agent backend listening on port ${PORT}`);
  console.log(`[Health Check]    http://localhost:${PORT}/api/health`);
  console.log(`[DB Health Check] http://localhost:${PORT}/api/db-health`);
  console.log(`[Doctors]         http://localhost:${PORT}/api/doctors`);
  console.log(`[Availability]    http://localhost:${PORT}/api/availability?doctorId=1&date=YYYY-MM-DD`);
  console.log(`[Appointments]    POST http://localhost:${PORT}/api/appointments`);
});

