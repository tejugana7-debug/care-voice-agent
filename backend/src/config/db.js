// ==========================================
// PostgreSQL Database Configuration (Connection Pool)
// ==========================================

const { Pool } = require('pg');

/**
 * Safely normalizes the database connection URL:
 * - Trims leading and trailing whitespace.
 * - Automatically percent-encodes special characters (such as '@') in the
 *   password if present, avoiding URL parsing errors in Node.js.
 *
 * @param {string} rawUrl - The raw connection string from process.env.DATABASE_URL
 * @returns {string} - The sanitized connection string
 */
function normalizeDatabaseUrl(rawUrl) {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();

  // Match: postgresql://username:password@hostname[:port]/database[?params]
  const match = trimmed.match(/^([a-zA-Z0-9+.-]+:\/\/)([^:]+):(.*)@([^@/]+)(\/.*)?$/);
  if (!match) {
    return trimmed;
  }

  const [, protocol, username, password, host, rest] = match;
  // If the password contains an unencoded '@', replace it with '%40'
  const safePassword = password.includes('@') ? password.replace(/@/g, '%40') : password;
  const pathAndQuery = rest || '';

  return `${protocol}${username}:${safePassword}@${host}${pathAndQuery}`;
}

// 1. Read and normalize DATABASE_URL from environment variables
const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

// 2. Configure connection pool options
const poolConfig = {
  // Pass connection string if defined
  connectionString: databaseUrl || undefined,
  // Supabase and hosted cloud databases enforce SSL connections.
  // rejectUnauthorized: false allows connecting securely without certificate trust issues.
  ssl: databaseUrl ? { rejectUnauthorized: false } : undefined,
  // Connection pool tuning for efficiency
  max: 10,                        // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,       // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000  // Return an error after 10s if connection cannot be established
};

// 3. Create the reusable PostgreSQL connection pool
const pool = new Pool(poolConfig);

// 4. Handle unexpected errors on idle pool clients so the process doesn't crash
pool.on('error', (err) => {
  // Safe logging: Never log credentials or full connection strings
  console.error('[PostgreSQL Pool Error] Unexpected idle client error:', err.code || err.name || 'Unknown');
});

// 5. Export the pool
module.exports = pool;
