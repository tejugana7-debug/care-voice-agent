// ==========================================
// Doctor Routes
// GET /api/doctors — returns all active doctors from PostgreSQL
// ==========================================

const express = require('express');
const router = express.Router();
const pool = require('../config/db');

/**
 * GET /api/doctors
 *
 * Returns a list of all doctors where active = true.
 * Columns returned: id, name, specialty, created_at
 *
 * Example response:
 * {
 *   "status": "ok",
 *   "count": 2,
 *   "doctors": [
 *     { "id": 1, "name": "Dr. Priya Sharma", "specialty": "Cardiologist", "created_at": "..." },
 *     ...
 *   ]
 * }
 */
router.get('/', async (req, res) => {
  try {
    // Parameterized query — only fetch doctors where active is TRUE
    const result = await pool.query(
      `SELECT id, name, specialty, created_at
       FROM doctors
       WHERE active = $1
       ORDER BY name ASC;`,
      [true]
    );

    return res.status(200).json({
      status: 'ok',
      count: result.rows.length,
      doctors: result.rows
    });
  } catch (error) {
    console.error('[GET /api/doctors] Database error:', error.code || error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve doctors',
      code: error.code || 'DB_QUERY_ERROR'
    });
  }
});

module.exports = router;
