// ==========================================
// Appointment Routes
// POST /api/appointments — book a confirmed appointment
// ==========================================

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

// ==========================================
// Input Validation Helpers (exported for unit tests)
// ==========================================

/**
 * Returns true if value is a non-empty string after trimming.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates an E.164-ish phone number: optional leading +, then 7–15 digits.
 * Accepts spaces and dashes between digit groups (e.g. "+91 98765 43210").
 * Does NOT attempt to be a world-complete validator; rejects obvious garbage.
 */
function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  // Strip spaces and dashes, then check format
  const stripped = value.replace(/[\s\-]/g, '');
  return /^\+?\d{7,15}$/.test(stripped);
}

/**
 * Validates an ISO 8601 datetime string that can be parsed into a valid Date.
 * Returns a Date object on success, or null on failure.
 */
function parseIsoDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns true if startTime is strictly before endTime
 * and the duration is exactly 30 minutes (matching slot size).
 */
function isValidSlotDuration(startDate, endDate) {
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  return endDate.getTime() - startDate.getTime() === THIRTY_MIN_MS;
}

// ==========================================
// Route
// ==========================================

/**
 * POST /api/appointments
 *
 * Request body (JSON):
 * {
 *   "doctorId":      1,                          // integer — required
 *   "patientName":   "Arjun Kapoor",             // string  — required
 *   "patientPhone":  "+91 98765 43210",           // string  — required (not logged)
 *   "startTime":     "2026-10-20T03:30:00.000Z", // ISO UTC — required
 *   "endTime":       "2026-10-20T04:00:00.000Z", // ISO UTC — required (must be startTime + 30 min)
 *   "confirmed":     true                        // boolean — must be exactly true
 * }
 *
 * Concurrency protection strategy:
 *   All conflict checks happen inside a BEGIN…COMMIT transaction.
 *   We use SELECT … FOR UPDATE on doctor_availability to acquire a row-level
 *   lock on the doctor's availability windows. Any concurrent transaction
 *   trying to book the same doctor on the same window will WAIT until the
 *   first one commits or rolls back — preventing double-booking.
 *
 * Success response (201):
 * {
 *   "status": "ok",
 *   "message": "Appointment booked successfully",
 *   "appointment": { id, doctor_id, patient_name, start_time, end_time, status, created_at }
 * }
 */
router.post('/', async (req, res) => {
  const { doctorId, patientName, patientPhone, startTime, endTime, confirmed } = req.body;

  // ── Step 1: Validate all fields ──────────────────────────────────────────────

  // 1a. Explicit patient confirmation must be boolean true
  if (confirmed !== true) {
    return res.status(400).json({
      status: 'error',
      message: 'You must set "confirmed": true to book an appointment'
    });
  }

  // 1b. doctorId must be a positive integer
  const parsedDoctorId = Number(doctorId);
  if (!Number.isInteger(parsedDoctorId) || parsedDoctorId <= 0) {
    return res.status(400).json({
      status: 'error',
      message: '"doctorId" is required and must be a positive integer'
    });
  }

  // 1c. patientName: required non-empty string
  if (!isNonEmptyString(patientName)) {
    return res.status(400).json({
      status: 'error',
      message: '"patientName" is required and must be a non-empty string'
    });
  }

  // 1d. patientPhone: required, must look like a real phone number
  if (!isValidPhone(patientPhone)) {
    return res.status(400).json({
      status: 'error',
      message: '"patientPhone" is required and must be a valid phone number (7–15 digits, optional leading +)'
    });
  }

  // 1e. startTime and endTime: must be valid ISO date strings
  const startDate = parseIsoDate(startTime);
  const endDate   = parseIsoDate(endTime);

  if (!startDate) {
    return res.status(400).json({
      status: 'error',
      message: '"startTime" is required and must be a valid ISO 8601 datetime string'
    });
  }
  if (!endDate) {
    return res.status(400).json({
      status: 'error',
      message: '"endTime" is required and must be a valid ISO 8601 datetime string'
    });
  }

  // 1f. Slot must be exactly 30 minutes
  if (!isValidSlotDuration(startDate, endDate)) {
    return res.status(400).json({
      status: 'error',
      message: '"endTime" must be exactly 30 minutes after "startTime"'
    });
  }

  // ── Steps 2–6: All inside a single transaction ────────────────────────────────
  // Acquire a dedicated client from the pool so we can control BEGIN/COMMIT/ROLLBACK.
  const client = await pool.connect();

  // Track whether we have sent a response already (for use in finally)
  let responded = false;

  try {
    await client.query('BEGIN');

    // ── Step 2: Verify doctor exists and is active ──────────────────────────────
    const doctorResult = await client.query(
      `SELECT id, name FROM doctors WHERE id = $1 AND active = $2 LIMIT 1;`,
      [parsedDoctorId, true]
    );

    if (doctorResult.rows.length === 0) {
      await client.query('ROLLBACK');
      responded = true;
      return res.status(404).json({
        status: 'error',
        message: `No active doctor found with id ${parsedDoctorId}`
      });
    }

    const doctor = doctorResult.rows[0];

    // ── Step 3: Lock the relevant availability row with FOR UPDATE ──────────────
    // This prevents two concurrent requests from simultaneously passing the
    // conflict check and both inserting an appointment for the same slot.
    // Any second transaction will WAIT here until the first commits or rolls back.
    const availabilityResult = await client.query(
      `SELECT id
       FROM doctor_availability
       WHERE doctor_id  = $1
         AND start_time <= $2::timestamptz
         AND end_time   >= $3::timestamptz
       FOR UPDATE;`,
      [parsedDoctorId, startDate.toISOString(), endDate.toISOString()]
    );

    // ── Step 4: Check the slot actually falls within an availability window ─────
    if (availabilityResult.rows.length === 0) {
      await client.query('ROLLBACK');
      responded = true;
      return res.status(409).json({
        status: 'error',
        message: 'The requested time slot is outside the doctor\'s availability windows'
      });
    }

    // ── Step 5: Check for overlapping confirmed appointments ────────────────────
    // Now that we hold the FOR UPDATE lock, no other transaction can insert
    // a conflicting appointment until we release it.
    const conflictResult = await client.query(
      `SELECT id
       FROM appointments
       WHERE doctor_id = $1
         AND status    = 'confirmed'
         AND start_time < $3::timestamptz
         AND end_time   > $2::timestamptz;`,
      [parsedDoctorId, startDate.toISOString(), endDate.toISOString()]
    );

    if (conflictResult.rows.length > 0) {
      await client.query('ROLLBACK');
      responded = true;
      return res.status(409).json({
        status: 'error',
        message: 'This time slot has already been booked. Please choose a different slot.'
      });
    }

    // ── Step 6: Insert the appointment ─────────────────────────────────────────
    // patient_phone is stored in the DB but never included in log output.
    const insertResult = await client.query(
      `INSERT INTO appointments
         (doctor_id, patient_name, patient_phone, start_time, end_time, status)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'confirmed')
       RETURNING id, doctor_id, patient_name, start_time, end_time, status, created_at;`,
      [
        parsedDoctorId,
        patientName.trim(),
        patientPhone.trim(),        // stored securely; never logged below
        startDate.toISOString(),
        endDate.toISOString()
      ]
    );

    await client.query('COMMIT');

    const appointment = insertResult.rows[0];

    // Safe log — no phone number, no credentials
    console.log(
      `[POST /api/appointments] Booked: id=${appointment.id}  ` +
      `doctor_id=${appointment.doctor_id}  ` +
      `patient="${appointment.patient_name}"  ` +
      `slot=${appointment.start_time}–${appointment.end_time}`
    );

    responded = true;
    return res.status(201).json({
      status: 'ok',
      message: 'Appointment booked successfully',
      appointment: {
        id:          appointment.id,
        doctorId:    appointment.doctor_id,
        doctorName:  doctor.name,
        patientName: appointment.patient_name,
        startTime:   appointment.start_time,
        endTime:     appointment.end_time,
        status:      appointment.status,
        createdAt:   appointment.created_at
      }
    });

  } catch (error) {
    // Always roll back if anything unexpected throws
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore rollback error */ }

    // Log only the error code — never credentials or patient data
    console.error('[POST /api/appointments] DB error:', error.code || error.name || 'UNKNOWN');

    responded = true;
    return res.status(500).json({
      status: 'error',
      message: 'Failed to book appointment due to a server error',
      code: error.code || 'DB_ERROR'
    });

  } finally {
    // Always release the client back to the pool, regardless of which branch ran.
    // This fixes the connection leak that existed when only the error path released.
    client.release();
  }

});

// Export route and helpers so tests can import them directly
module.exports = router;
module.exports.isNonEmptyString     = isNonEmptyString;
module.exports.isValidPhone         = isValidPhone;
module.exports.parseIsoDate         = parseIsoDate;
module.exports.isValidSlotDuration  = isValidSlotDuration;
