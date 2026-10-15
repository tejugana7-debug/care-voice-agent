// ==========================================
// Availability Routes
// GET /api/availability?doctorId=...&date=YYYY-MM-DD
// ==========================================

const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ==========================================
// Input Validation Helpers
// ==========================================

/**
 * Validates that a doctorId is a positive integer.
 * Returns the parsed integer, or null if invalid.
 */
function parseIntId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Validates a date string in YYYY-MM-DD format.
 * Returns true only if the string is a valid calendar date
 * (rejects things like "2026-02-30" or "not-a-date").
 */
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  // Must exactly match YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr);
  // Check that the Date parsed correctly and the ISO string starts with the same date
  return !isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
}

// ==========================================
// Slot Generation
// ==========================================

/**
 * Splits a continuous availability window into discrete 30-minute slots.
 *
 * @param {Date} windowStart - Start of the availability window
 * @param {Date} windowEnd   - End of the availability window
 * @returns {Array<{slotStart: Date, slotEnd: Date}>} List of 30-minute slots
 */
function generateSlots(windowStart, windowEnd) {
  const SLOT_DURATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds
  const slots = [];
  let current = new Date(windowStart);

  while (current.getTime() + SLOT_DURATION_MS <= windowEnd.getTime()) {
    const slotEnd = new Date(current.getTime() + SLOT_DURATION_MS);
    slots.push({ slotStart: new Date(current), slotEnd });
    current = slotEnd;
  }

  return slots;
}

/**
 * Returns true if a candidate slot overlaps an existing appointment.
 * Overlap condition: slotStart < apptEnd AND slotEnd > apptStart
 *
 * @param {Date} slotStart
 * @param {Date} slotEnd
 * @param {Array<{start_time: string, end_time: string}>} appointments
 */
function overlapsBookedAppointment(slotStart, slotEnd, appointments) {
  return appointments.some(appt => {
    const apptStart = new Date(appt.start_time);
    const apptEnd = new Date(appt.end_time);
    // Standard interval overlap: slot overlaps if it starts before appt ends
    // AND ends after appt starts
    return slotStart < apptEnd && slotEnd > apptStart;
  });
}

// ==========================================
// Route
// ==========================================

/**
 * GET /api/availability
 *
 * Query Parameters:
 *   doctorId  {integer}    — Required. Must be a positive integer.
 *   date      {string}     — Required. Must be in YYYY-MM-DD format.
 *
 * Logic:
 *   1. Validate doctorId and date.
 *   2. Confirm the doctor exists and is active.
 *   3. Fetch all doctor_availability windows for that doctor on that date.
 *   4. Fetch all confirmed appointments for that doctor on that date.
 *   5. Slice each availability window into 30-minute slots.
 *   6. Remove any slot that overlaps a confirmed appointment.
 *   7. Return the free slots as ISO strings.
 *
 * Example success response:
 * {
 *   "status": "ok",
 *   "doctorId": 1,
 *   "date": "2026-10-20",
 *   "availableSlots": [
 *     { "start": "2026-10-20T09:00:00.000Z", "end": "2026-10-20T09:30:00.000Z" },
 *     ...
 *   ]
 * }
 */
router.get('/', async (req, res) => {
  const { doctorId, date } = req.query;

  // ── Step 1: Validate inputs ─────────────────────────────────────────────────
  const parsedDoctorId = parseIntId(doctorId);
  if (parsedDoctorId === null) {
    return res.status(400).json({
      status: 'error',
      message: 'doctorId is required and must be a positive integer (e.g., ?doctorId=1)'
    });
  }

  if (!isValidDate(date)) {
    return res.status(400).json({
      status: 'error',
      message: 'date is required and must be a valid YYYY-MM-DD string (e.g., ?date=2026-10-20)'
    });
  }

  try {
    // ── Step 2: Confirm doctor exists and is active ─────────────────────────────
    const doctorResult = await pool.query(
      `SELECT id, name, specialty FROM doctors WHERE id = $1 AND active = $2 LIMIT 1;`,
      [parsedDoctorId, true]
    );

    if (doctorResult.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No active doctor found with id ${parsedDoctorId}`
      });
    }

    const doctor = doctorResult.rows[0];

    // ── Step 3: Fetch availability windows for the requested date ───────────────
    // Use AT TIME ZONE with date casting to match the date regardless of stored timezone.
    // start_time and end_time are timestamptz in the database.
    const availabilityResult = await pool.query(
      `SELECT start_time, end_time
       FROM doctor_availability
       WHERE doctor_id = $1
         AND DATE(start_time AT TIME ZONE 'UTC') = $2::date
       ORDER BY start_time ASC;`,
      [parsedDoctorId, date]
    );

    // If the doctor has no availability windows on this date, return empty
    if (availabilityResult.rows.length === 0) {
      return res.status(200).json({
        status: 'ok',
        doctorId: parsedDoctorId,
        doctorName: doctor.name,
        date,
        availableSlots: [],
        message: 'Doctor has no availability windows on this date'
      });
    }

    // ── Step 4: Fetch all confirmed appointments for that doctor on that date ───
    const appointmentsResult = await pool.query(
      `SELECT start_time, end_time
       FROM appointments
       WHERE doctor_id = $1
         AND status    = $2
         AND DATE(start_time AT TIME ZONE 'UTC') = $3::date;`,
      [parsedDoctorId, 'confirmed', date]
    );

    const bookedAppointments = appointmentsResult.rows;

    // ── Step 5 & 6: Generate 30-min slots, exclude booked ones ─────────────────
    const availableSlots = [];

    for (const window of availabilityResult.rows) {
      const windowStart = new Date(window.start_time);
      const windowEnd = new Date(window.end_time);
      const slots = generateSlots(windowStart, windowEnd);

      for (const slot of slots) {
        if (!overlapsBookedAppointment(slot.slotStart, slot.slotEnd, bookedAppointments)) {
          availableSlots.push({
            start: slot.slotStart.toISOString(),
            end: slot.slotEnd.toISOString()
          });
        }
      }
    }

    // ── Step 7: Return results ──────────────────────────────────────────────────
    return res.status(200).json({
      status: 'ok',
      doctorId: parsedDoctorId,
      doctorName: doctor.name,
      specialty: doctor.specialty,
      date,
      availableSlots,
      totalAvailable: availableSlots.length,
      totalBooked: bookedAppointments.length
    });

  } catch (error) {
    console.error('[GET /api/availability] Database error:', error.code || error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve availability',
      code: error.code || 'DB_QUERY_ERROR'
    });
  }
});

// Export route logic and helpers separately so tests can import them directly
module.exports = router;
module.exports.parseIntId = parseIntId;
module.exports.isValidDate = isValidDate;
module.exports.generateSlots = generateSlots;
module.exports.overlapsBookedAppointment = overlapsBookedAppointment;
