// ==========================================
// Tests: src/routes/availability.js
//
// Two test suites:
//   1. Unit tests — pure functions, no database, no HTTP
//   2. Integration tests — HTTP via supertest, database mocked with jest.mock
// ==========================================

// ─── Import the pure helper functions from the route ────────────────────────
const {
  parseIntId,
  isValidDate,
  generateSlots,
  overlapsBookedAppointment
} = require('../src/routes/availability');

// ─── Mock the database pool BEFORE importing the Express app ────────────────
// This prevents the tests from touching a real database and making them fast.
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  on: jest.fn()    // pool.on('error', ...) is called at module load
}));

const request  = require('supertest');
const express  = require('express');

// Build a minimal Express app for HTTP integration tests
function buildTestApp() {
  const app = express();
  app.use(express.json());
  // Mount the REAL router (it will use the mocked pool)
  const doctorsRouter      = require('../src/routes/doctors');
  const availabilityRouter = require('../src/routes/availability');
  app.use('/api/doctors', doctorsRouter);
  app.use('/api/availability', availabilityRouter);
  return app;
}

const pool = require('../src/config/db');

// ============================================================
// UNIT TEST SUITE — Pure helper functions
// ============================================================
describe('parseIntId()', () => {
  test('returns a positive integer for "1"',         () => expect(parseIntId('1')).toBe(1));
  test('returns the integer for numeric 5',          () => expect(parseIntId(5)).toBe(5));
  test('returns null for "0" (not positive)',        () => expect(parseIntId('0')).toBeNull());
  test('returns null for "-3" (negative)',           () => expect(parseIntId('-3')).toBeNull());
  test('returns null for "abc" (non-numeric)',       () => expect(parseIntId('abc')).toBeNull());
  test('returns null for "1.5" (float)',             () => expect(parseIntId('1.5')).toBeNull());
  test('returns null for undefined',                 () => expect(parseIntId(undefined)).toBeNull());
  test('returns null for empty string',              () => expect(parseIntId('')).toBeNull());
});

describe('isValidDate()', () => {
  test('accepts "2026-10-15"',                       () => expect(isValidDate('2026-10-15')).toBe(true));
  test('accepts "2026-02-28"',                       () => expect(isValidDate('2026-02-28')).toBe(true));
  test('rejects "2026-02-30" (impossible date)',     () => expect(isValidDate('2026-02-30')).toBe(false));
  test('rejects "20261015" (no dashes)',             () => expect(isValidDate('20261015')).toBe(false));
  test('rejects "15-10-2026" (wrong order)',         () => expect(isValidDate('15-10-2026')).toBe(false));
  test('rejects "not-a-date"',                       () => expect(isValidDate('not-a-date')).toBe(false));
  test('rejects undefined',                          () => expect(isValidDate(undefined)).toBe(false));
  test('rejects number 20261015',                    () => expect(isValidDate(20261015)).toBe(false));
});

describe('generateSlots()', () => {
  test('generates 2 slots for a 1-hour window', () => {
    const start = new Date('2026-10-20T09:00:00Z');
    const end   = new Date('2026-10-20T10:00:00Z');
    const slots = generateSlots(start, end);
    expect(slots).toHaveLength(2);
    expect(slots[0].slotStart.toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(slots[0].slotEnd.toISOString()).toBe(  '2026-10-20T09:30:00.000Z');
    expect(slots[1].slotStart.toISOString()).toBe('2026-10-20T09:30:00.000Z');
    expect(slots[1].slotEnd.toISOString()).toBe(  '2026-10-20T10:00:00.000Z');
  });

  test('generates 0 slots if window is less than 30 minutes', () => {
    const start = new Date('2026-10-20T09:00:00Z');
    const end   = new Date('2026-10-20T09:15:00Z');
    expect(generateSlots(start, end)).toHaveLength(0);
  });

  test('generates exactly 1 slot for a 30-minute window', () => {
    const start = new Date('2026-10-20T09:00:00Z');
    const end   = new Date('2026-10-20T09:30:00Z');
    expect(generateSlots(start, end)).toHaveLength(1);
  });

  test('generates 16 slots for an 8-hour window', () => {
    const start = new Date('2026-10-20T09:00:00Z');
    const end   = new Date('2026-10-20T17:00:00Z');
    expect(generateSlots(start, end)).toHaveLength(16);
  });
});

describe('overlapsBookedAppointment()', () => {
  const booked = [
    { start_time: '2026-10-20T09:30:00Z', end_time: '2026-10-20T10:00:00Z' }
  ];

  test('detects overlap: slot fully inside booked',    () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T09:30:00Z'),
      new Date('2026-10-20T10:00:00Z'),
      booked
    )).toBe(true);
  });

  test('detects overlap: slot starts before, ends inside', () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T09:15:00Z'),
      new Date('2026-10-20T09:45:00Z'),
      booked
    )).toBe(true);
  });

  test('detects overlap: slot starts inside, ends after', () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T09:45:00Z'),
      new Date('2026-10-20T10:15:00Z'),
      booked
    )).toBe(true);
  });

  test('no overlap: slot is exactly before booked',   () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T09:00:00Z'),
      new Date('2026-10-20T09:30:00Z'),
      booked
    )).toBe(false);
  });

  test('no overlap: slot is exactly after booked',    () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T10:00:00Z'),
      new Date('2026-10-20T10:30:00Z'),
      booked
    )).toBe(false);
  });

  test('no overlap: empty booked array',              () => {
    expect(overlapsBookedAppointment(
      new Date('2026-10-20T09:00:00Z'),
      new Date('2026-10-20T09:30:00Z'),
      []
    )).toBe(false);
  });
});

// ============================================================
// INTEGRATION TEST SUITE — HTTP endpoints (DB mocked)
// ============================================================
describe('GET /api/doctors', () => {
  let app;
  beforeAll(() => { app = buildTestApp(); });
  afterEach(() => { jest.clearAllMocks(); });

  test('200 — returns active doctors', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'Dr. Priya Sharma', specialty: 'Cardiologist', created_at: '2026-01-01T00:00:00Z' }
      ]
    });
    const res = await request(app).get('/api/doctors');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.count).toBe(1);
    expect(res.body.doctors[0].name).toBe('Dr. Priya Sharma');
  });

  test('200 — returns empty list when no active doctors', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/doctors');
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.doctors).toEqual([]);
  });

  test('500 — db error returns safe error response', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: '08006' }));
    const res = await request(app).get('/api/doctors');
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('error');
    // Must NOT expose DB details
    expect(JSON.stringify(res.body)).not.toMatch(/postgres/i);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });
});

describe('GET /api/availability', () => {
  let app;
  beforeAll(() => { app = buildTestApp(); });
  afterEach(() => { jest.clearAllMocks(); });

  // ── Input validation ────────────────────────────────────────
  test('400 — missing doctorId', async () => {
    const res = await request(app).get('/api/availability?date=2026-10-20');
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/doctorId/i);
  });

  test('400 — doctorId is zero', async () => {
    const res = await request(app).get('/api/availability?doctorId=0&date=2026-10-20');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/doctorId/i);
  });

  test('400 — doctorId is non-numeric', async () => {
    const res = await request(app).get('/api/availability?doctorId=abc&date=2026-10-20');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/doctorId/i);
  });

  test('400 — missing date', async () => {
    const res = await request(app).get('/api/availability?doctorId=1');
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/date/i);
  });

  test('400 — invalid date format', async () => {
    const res = await request(app).get('/api/availability?doctorId=1&date=15-10-2026');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/date/i);
  });

  test('400 — impossible date', async () => {
    const res = await request(app).get('/api/availability?doctorId=1&date=2026-02-30');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/date/i);
  });

  // ── Doctor not found ────────────────────────────────────────
  test('404 — unknown doctorId', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // doctor lookup returns nothing
    const res = await request(app).get('/api/availability?doctorId=999&date=2026-10-20');
    expect(res.statusCode).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/999/);
  });

  // ── No availability windows ─────────────────────────────────
  test('200 — doctor with no availability on that date', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Dr. Priya', specialty: 'GP' }] }) // doctor
      .mockResolvedValueOnce({ rows: [] });                                               // availability
    const res = await request(app).get('/api/availability?doctorId=1&date=2026-10-20');
    expect(res.statusCode).toBe(200);
    expect(res.body.availableSlots).toEqual([]);
    expect(res.body.message).toMatch(/no availability/i);
  });

  // ── Available slots returned ────────────────────────────────
  test('200 — returns available slots with no bookings', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Dr. Priya', specialty: 'GP' }] })
      .mockResolvedValueOnce({ rows: [
        // 1-hour window → 2 slots
        { start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T10:00:00Z' }
      ]})
      .mockResolvedValueOnce({ rows: [] }); // no booked appointments

    const res = await request(app).get('/api/availability?doctorId=1&date=2026-10-20');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.availableSlots).toHaveLength(2);
    expect(res.body.availableSlots[0].start).toBe('2026-10-20T09:00:00.000Z');
    expect(res.body.availableSlots[0].end).toBe(  '2026-10-20T09:30:00.000Z');
    expect(res.body.totalBooked).toBe(0);
  });

  // ── Booked slot excluded ────────────────────────────────────
  test('200 — excludes slot that overlaps a confirmed appointment', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Dr. Priya', specialty: 'GP' }] })
      .mockResolvedValueOnce({ rows: [
        { start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T10:00:00Z' } // 2 possible slots
      ]})
      .mockResolvedValueOnce({ rows: [
        // First slot (09:00–09:30) is booked
        { start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T09:30:00Z' }
      ]});

    const res = await request(app).get('/api/availability?doctorId=1&date=2026-10-20');
    expect(res.statusCode).toBe(200);
    // Only 1 slot should remain (09:30–10:00)
    expect(res.body.availableSlots).toHaveLength(1);
    expect(res.body.availableSlots[0].start).toBe('2026-10-20T09:30:00.000Z');
    expect(res.body.totalBooked).toBe(1);
  });

  // ── All slots booked ────────────────────────────────────────
  test('200 — all slots booked returns empty availableSlots', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Dr. Priya', specialty: 'GP' }] })
      .mockResolvedValueOnce({ rows: [
        { start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T10:00:00Z' }
      ]})
      .mockResolvedValueOnce({ rows: [
        // Both slots booked
        { start_time: '2026-10-20T09:00:00Z', end_time: '2026-10-20T09:30:00Z' },
        { start_time: '2026-10-20T09:30:00Z', end_time: '2026-10-20T10:00:00Z' }
      ]});

    const res = await request(app).get('/api/availability?doctorId=1&date=2026-10-20');
    expect(res.statusCode).toBe(200);
    expect(res.body.availableSlots).toHaveLength(0);
    expect(res.body.totalBooked).toBe(2);
  });

  // ── DB error ────────────────────────────────────────────────
  test('500 — db error returns safe error, no secrets exposed', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('FATAL: password auth failed for user postgres'), { code: '28P01' }));
    const res = await request(app).get('/api/availability?doctorId=1&date=2026-10-20');
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('error');
    // Ensure no secrets leak into the response body
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres:\/\//i);
  });
});
