// ==========================================
// Demo Data Seed Script
// scripts/seed-demo-data.js
//
// Usage:   node scripts/seed-demo-data.js
// Purpose: Inserts two fictional doctors and their availability windows
//          for 2026-10-20, using Asia/Kolkata (IST = UTC+5:30) office hours.
//
// Safety guarantees:
//   - Does NOT drop or truncate any table.
//   - Does NOT insert real patient information.
//   - Uses INSERT ... WHERE NOT EXISTS to avoid duplicate rows on re-run.
//   - Credentials are never printed — only doctor names and slot times.
// ==========================================

require('dotenv').config();
const pool = require('../src/config/db');

// ──────────────────────────────────────────────────────────────
// IST → UTC helper
// ──────────────────────────────────────────────────────────────
// The availability.js query filters with:
//   DATE(start_time AT TIME ZONE 'UTC') = $2::date
//
// That means it looks at the UTC date of start_time.
// Our availability windows are stored as timestamptz (UTC in the DB).
// IST is UTC+5:30, so to store an IST time we subtract 5h30m.
//
// Example:  IST 09:00 on 2026-10-20  →  UTC 03:30 on 2026-10-20  ✓
//           IST 17:00 on 2026-10-20  →  UTC 11:30 on 2026-10-20  ✓
//
// @param {string} dateStr  — "YYYY-MM-DD"
// @param {string} timeStr  — "HH:MM" in IST
// @returns {string}        — ISO 8601 UTC string safe for PostgreSQL timestamptz
// ──────────────────────────────────────────────────────────────
function istToUtcIso(dateStr, timeStr) {
  const [year, month, day]     = dateStr.split('-').map(Number);
  const [hours, minutes]       = timeStr.split(':').map(Number);

  // Build a UTC Date that represents the IST moment
  // IST = UTC + 5h30m  →  UTC = IST - 5h30m
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours - 5, minutes - 30));
  return utcDate.toISOString();  // e.g. "2026-10-20T03:30:00.000Z"
}

// ──────────────────────────────────────────────────────────────
// Seed data definition
// ──────────────────────────────────────────────────────────────
const SEED_DATE = '2026-10-20';

const DEMO_DOCTORS = [
  {
    name:      'Dr. Priya Sharma',
    specialty: 'Cardiologist',
    // Two IST windows on SEED_DATE:
    //   Morning:   09:00–13:00 IST  (8 slots × 30 min)
    //   Afternoon: 14:00–17:00 IST  (6 slots × 30 min)
    // Total: 14 available 30-minute slots
    availability: [
      { startIst: '09:00', endIst: '13:00' },
      { startIst: '14:00', endIst: '17:00' }
    ]
  },
  {
    name:      'Dr. Rohan Mehta',
    specialty: 'General Physician',
    // Single IST window:
    //   Full day:  08:30–16:30 IST  (16 slots × 30 min)
    availability: [
      { startIst: '08:30', endIst: '16:30' }
    ]
  }
];

// ──────────────────────────────────────────────────────────────
// Seed runner
// ──────────────────────────────────────────────────────────────
async function seed() {
  console.log('=== Care Voice Agent — Demo Data Seed ===\n');
  console.log(`Seeding availability for date: ${SEED_DATE} (Asia/Kolkata)\n`);

  // Use a single transaction so the whole seed is atomic —
  // if anything fails mid-way, nothing is committed.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const doctor of DEMO_DOCTORS) {
      // ── 1. Upsert doctor ──────────────────────────────────────
      // Insert only if a doctor with this exact name does not already exist.
      // Uses a CTE (WITH) so we can return the id regardless of
      // whether the row was newly inserted or already present.
      const doctorResult = await client.query(
        `WITH inserted AS (
           INSERT INTO doctors (name, specialty, active)
           SELECT $1, $2, true
           WHERE NOT EXISTS (
             SELECT 1 FROM doctors WHERE name = $1
           )
           RETURNING id, name, specialty
         )
         SELECT id, name, specialty FROM inserted
         UNION ALL
         SELECT id, name, specialty FROM doctors WHERE name = $1
         LIMIT 1;`,
        [doctor.name, doctor.specialty]
      );

      const row = doctorResult.rows[0];
      const doctorId = row.id;
      const isNew    = doctorResult.rowCount === 1 && doctorResult.command !== 'SELECT';

      console.log(
        `  Doctor: ${row.name} (${row.specialty}) — id=${doctorId}  [${isNew ? 'INSERTED' : 'already existed'}]`
      );

      // ── 2. Insert availability windows (idempotent) ────────────
      for (const window of doctor.availability) {
        const startUtc = istToUtcIso(SEED_DATE, window.startIst);
        const endUtc   = istToUtcIso(SEED_DATE, window.endIst);

        // Skip if this exact (doctor_id, start_time, end_time) row already exists
        const avResult = await client.query(
          `INSERT INTO doctor_availability (doctor_id, start_time, end_time)
           SELECT $1, $2::timestamptz, $3::timestamptz
           WHERE NOT EXISTS (
             SELECT 1 FROM doctor_availability
             WHERE doctor_id = $1
               AND start_time = $2::timestamptz
               AND end_time   = $3::timestamptz
           )
           RETURNING id;`,
          [doctorId, startUtc, endUtc]
        );

        const slotCount = Math.floor(
          (new Date(endUtc) - new Date(startUtc)) / (30 * 60 * 1000)
        );

        if (avResult.rowCount > 0) {
          console.log(
            `    ✓ Availability  IST ${window.startIst}–${window.endIst}  ` +
            `(UTC ${startUtc.slice(11, 16)}–${endUtc.slice(11, 16)})  ` +
            `→ ${slotCount} slots  [INSERTED]`
          );
        } else {
          console.log(
            `    – Availability  IST ${window.startIst}–${window.endIst}  [already existed, skipped]`
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed completed successfully.\n');

    // ── 3. Summary: verify what is now in the DB ──────────────────
    console.log('=== Current doctors table ===');
    const docRows = await pool.query(
      `SELECT id, name, specialty, active FROM doctors ORDER BY id;`
    );
    docRows.rows.forEach(d =>
      console.log(`  id=${d.id}  name="${d.name}"  specialty="${d.specialty}"  active=${d.active}`)
    );

    console.log('\n=== Availability windows for', SEED_DATE, '===');
    const avRows = await pool.query(
      `SELECT da.id, da.doctor_id, d.name AS doctor_name,
              da.start_time AT TIME ZONE 'Asia/Kolkata' AS start_ist,
              da.end_time   AT TIME ZONE 'Asia/Kolkata' AS end_ist
       FROM doctor_availability da
       JOIN doctors d ON d.id = da.doctor_id
       WHERE DATE(da.start_time AT TIME ZONE 'UTC') = $1::date
       ORDER BY da.doctor_id, da.start_time;`,
      [SEED_DATE]
    );

    if (avRows.rows.length === 0) {
      console.log('  (none found — check SEED_DATE or timezone conversion)');
    } else {
      avRows.rows.forEach(r => {
        const startIst = new Date(r.start_ist).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const endIst   = new Date(r.end_ist).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        console.log(`  doctor_id=${r.doctor_id}  "${r.doctor_name}"  IST ${startIst}–${endIst}`);
      });
    }

    console.log('\n=== How to test the live endpoints ===');
    console.log(`  GET  http://localhost:5000/api/doctors`);
    docRows.rows.forEach(d => {
      console.log(`  GET  http://localhost:5000/api/availability?doctorId=${d.id}&date=${SEED_DATE}`);
    });
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    // Never log credentials — only the error code/type
    console.error('\n❌ Seed failed — transaction rolled back.');
    console.error('   Error code:', err.code  || 'N/A');
    console.error('   Error name:', err.name  || 'N/A');
    // Strip any connection strings before printing the message
    const safeMsg = (err.message || '').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED]');
    console.error('   Message:', safeMsg);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
