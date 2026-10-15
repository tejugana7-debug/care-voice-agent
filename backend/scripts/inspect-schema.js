// ==========================================
// One-shot schema inspector — run this ONCE then delete it
// Usage: node scripts/inspect-schema.js
// ==========================================
require('dotenv').config();
const pool = require('../src/config/db');

async function inspectSchema() {
  const tables = ['doctors', 'doctor_availability', 'appointments'];

  for (const table of tables) {
    console.log(`\n=== Table: ${table} ===`);
    try {
      // Fetch column names, types, and nullability from information_schema
      const { rows } = await pool.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1
        ORDER BY ordinal_position;
      `, [table]);

      if (rows.length === 0) {
        console.log('  (table not found or has no columns)');
      } else {
        rows.forEach(r =>
          console.log(`  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(24)} nullable=${r.is_nullable}  default=${r.column_default ?? 'none'}`)
        );
      }

      // Show a sample row so we know real data
      const sample = await pool.query(`SELECT * FROM ${table} LIMIT 1;`);
      if (sample.rows.length > 0) {
        console.log('  Sample row:', JSON.stringify(sample.rows[0], null, 2));
      } else {
        console.log('  (no rows yet)');
      }
    } catch (err) {
      console.error(`  ERROR reading ${table}:`, err.message);
    }
  }

  await pool.end();
}

inspectSchema();
