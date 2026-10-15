// ==========================================
// Tests: src/routes/appointments.js
//
// Two test suites:
//   1. Unit tests — pure validation helpers (no DB, no HTTP)
//   2. Integration tests — HTTP via supertest, DB fully mocked
//
// Concurrency note:
//   The route uses pool.connect() to get a dedicated client, then
//   BEGIN / SELECT FOR UPDATE / INSERT / COMMIT inside a transaction.
//   The mock exposes connect() returning a fake client object.
// ==========================================

// ─── Import pure helpers BEFORE any mocks are set up ──────────────────────────
const {
  isNonEmptyString,
  isValidPhone,
  parseIsoDate,
  isValidSlotDuration
} = require('../src/routes/appointments');

// ─── Mock pool BEFORE requiring Express app ────────────────────────────────────
// Must include both .query() (used by doctors/availability in same pool import)
// and .connect() (used by the appointments transaction).
jest.mock('../src/config/db', () => ({
  query:   jest.fn(),
  connect: jest.fn(),
  on:      jest.fn()
}));

const request = require('supertest');
const express = require('express');
const pool    = require('../src/config/db');

// ── Shared fake client factory ─────────────────────────────────────────────────
// Returns a mock client with controllable .query(), .release(), and a call log.
function makeFakeClient(responses = []) {
  let callIndex = 0;
  const client = {
    _queryArgs: [],   // record every query call for assertions
    query: jest.fn((...args) => {
      client._queryArgs.push(args);
      if (callIndex < responses.length) {
        const r = responses[callIndex++];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r);
      }
      // Default: return empty rows for any call beyond the defined responses
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: jest.fn()
  };
  return client;
}

// ── Build a minimal Express app for HTTP integration tests ─────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/appointments', require('../src/routes/appointments'));
  return app;
}

// ── Standard valid body ────────────────────────────────────────────────────────
const VALID_BODY = {
  doctorId:     1,
  patientName:  'Arjun Kapoor',
  patientPhone: '+91 98765 43210',
  startTime:    '2026-10-20T03:30:00.000Z',  // 09:00 IST
  endTime:      '2026-10-20T04:00:00.000Z',  // 09:30 IST
  confirmed:    true
};

// ── DB rows that represent a successful booking path ──────────────────────────
const DB_DOCTOR_ROW    = { rows: [{ id: 1, name: 'Dr. Priya Sharma' }], rowCount: 1 };
const DB_AVAIL_ROW     = { rows: [{ id: 10 }], rowCount: 1 };     // availability window found
const DB_NO_CONFLICT   = { rows: [], rowCount: 0 };                // no overlapping appointment
const DB_INSERT_ROW    = {
  rows: [{
    id: 42, doctor_id: 1, patient_name: 'Arjun Kapoor',
    start_time: '2026-10-20T03:30:00.000Z', end_time: '2026-10-20T04:00:00.000Z',
    status: 'confirmed', created_at: '2026-10-15T05:30:00.000Z'
  }],
  rowCount: 1
};

// Transaction sequence for a successful booking:
// BEGIN → doctor → availability (FOR UPDATE) → conflict check → INSERT → COMMIT
function successClientResponses() {
  return [
    { rows: [], rowCount: 0 },  // BEGIN
    DB_DOCTOR_ROW,              // SELECT doctor
    DB_AVAIL_ROW,               // SELECT availability FOR UPDATE
    DB_NO_CONFLICT,             // SELECT conflict check
    DB_INSERT_ROW,              // INSERT appointment
    { rows: [], rowCount: 0 }   // COMMIT
  ];
}

// ============================================================
// UNIT TESTS — Pure validation helpers
// ============================================================
describe('isNonEmptyString()', () => {
  test('true for normal string',      () => expect(isNonEmptyString('hello')).toBe(true));
  test('true for string with spaces', () => expect(isNonEmptyString('  a  ')).toBe(true));
  test('false for empty string',      () => expect(isNonEmptyString('')).toBe(false));
  test('false for only spaces',       () => expect(isNonEmptyString('   ')).toBe(false));
  test('false for undefined',         () => expect(isNonEmptyString(undefined)).toBe(false));
  test('false for number',            () => expect(isNonEmptyString(42)).toBe(false));
});

describe('isValidPhone()', () => {
  test('accepts "+91 98765 43210"',   () => expect(isValidPhone('+91 98765 43210')).toBe(true));
  test('accepts "+14155552671"',      () => expect(isValidPhone('+14155552671')).toBe(true));
  test('accepts "9876543210"',        () => expect(isValidPhone('9876543210')).toBe(true));
  test('rejects "123" (too short)',   () => expect(isValidPhone('123')).toBe(false));
  test('rejects "not-a-phone"',       () => expect(isValidPhone('not-a-phone')).toBe(false));
  test('rejects empty string',        () => expect(isValidPhone('')).toBe(false));
  test('rejects undefined',           () => expect(isValidPhone(undefined)).toBe(false));
});

describe('parseIsoDate()', () => {
  test('returns Date for valid ISO string', () => {
    const d = parseIsoDate('2026-10-20T03:30:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-10-20T03:30:00.000Z');
  });
  test('returns null for "not-a-date"',     () => expect(parseIsoDate('not-a-date')).toBeNull());
  test('returns null for empty string',     () => expect(parseIsoDate('')).toBeNull());
  test('returns null for undefined',        () => expect(parseIsoDate(undefined)).toBeNull());
});

describe('isValidSlotDuration()', () => {
  test('true for exactly 30 minutes',  () => {
    expect(isValidSlotDuration(
      new Date('2026-10-20T03:30:00Z'),
      new Date('2026-10-20T04:00:00Z')
    )).toBe(true);
  });
  test('false for 60 minutes', () => {
    expect(isValidSlotDuration(
      new Date('2026-10-20T03:30:00Z'),
      new Date('2026-10-20T04:30:00Z')
    )).toBe(false);
  });
  test('false for 15 minutes', () => {
    expect(isValidSlotDuration(
      new Date('2026-10-20T03:30:00Z'),
      new Date('2026-10-20T03:45:00Z')
    )).toBe(false);
  });
  test('false when end is before start', () => {
    expect(isValidSlotDuration(
      new Date('2026-10-20T04:00:00Z'),
      new Date('2026-10-20T03:30:00Z')
    )).toBe(false);
  });
});

// ============================================================
// INTEGRATION TESTS — HTTP endpoints (DB fully mocked)
// ============================================================
describe('POST /api/appointments', () => {
  let app;
  beforeAll(() => { app = buildApp(); });
  afterEach(() => { jest.clearAllMocks(); });

  // ── Missing / wrong confirmed flag ────────────────────────────
  test('400 — missing confirmed field', async () => {
    const body = { ...VALID_BODY };
    delete body.confirmed;
    const res = await request(app).post('/api/appointments').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/confirmed/i);
  });

  test('400 — confirmed is false', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, confirmed: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/confirmed/i);
  });

  test('400 — confirmed is string "true" (not boolean)', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, confirmed: 'true' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/confirmed/i);
  });

  // ── doctorId validation ────────────────────────────────────────
  test('400 — missing doctorId', async () => {
    const body = { ...VALID_BODY };
    delete body.doctorId;
    const res = await request(app).post('/api/appointments').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/doctorId/i);
  });

  test('400 — doctorId is zero', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, doctorId: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/doctorId/i);
  });

  test('400 — doctorId is a string', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, doctorId: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/doctorId/i);
  });

  // ── patientName validation ─────────────────────────────────────
  test('400 — missing patientName', async () => {
    const body = { ...VALID_BODY };
    delete body.patientName;
    const res = await request(app).post('/api/appointments').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/patientName/i);
  });

  test('400 — patientName is empty string', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, patientName: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/patientName/i);
  });

  // ── patientPhone validation ────────────────────────────────────
  test('400 — missing patientPhone', async () => {
    const body = { ...VALID_BODY };
    delete body.patientPhone;
    const res = await request(app).post('/api/appointments').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/patientPhone/i);
  });

  test('400 — patientPhone too short', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, patientPhone: '123' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/patientPhone/i);
  });

  // ── startTime / endTime validation ────────────────────────────
  test('400 — missing startTime', async () => {
    const body = { ...VALID_BODY };
    delete body.startTime;
    const res = await request(app).post('/api/appointments').send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/startTime/i);
  });

  test('400 — invalid startTime format', async () => {
    const res = await request(app).post('/api/appointments')
      .send({ ...VALID_BODY, startTime: 'not-a-date' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/startTime/i);
  });

  test('400 — endTime is not 30 minutes after startTime', async () => {
    const res = await request(app).post('/api/appointments').send({
      ...VALID_BODY,
      startTime: '2026-10-20T03:30:00.000Z',
      endTime:   '2026-10-20T04:30:00.000Z'  // 60 minutes — wrong
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/30 minutes/i);
  });

  // ── Unknown doctor ────────────────────────────────────────────
  test('404 — unknown or inactive doctor', async () => {
    pool.connect.mockResolvedValueOnce(makeFakeClient([
      { rows: [], rowCount: 0 },  // BEGIN
      { rows: [], rowCount: 0 }   // SELECT doctor → not found
    ]));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/no active doctor/i);
  });

  // ── Slot outside availability window ─────────────────────────
  test('409 — slot outside doctor availability', async () => {
    pool.connect.mockResolvedValueOnce(makeFakeClient([
      { rows: [], rowCount: 0 },   // BEGIN
      DB_DOCTOR_ROW,               // doctor found
      { rows: [], rowCount: 0 }    // availability FOR UPDATE → no window covers this slot
    ]));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/outside the doctor's availability/i);
  });

  // ── Slot already booked (conflict) ───────────────────────────
  test('409 — slot already booked by another appointment', async () => {
    pool.connect.mockResolvedValueOnce(makeFakeClient([
      { rows: [], rowCount: 0 },             // BEGIN
      DB_DOCTOR_ROW,                         // doctor
      DB_AVAIL_ROW,                          // availability FOR UPDATE
      { rows: [{ id: 7 }], rowCount: 1 }    // conflict found
    ]));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/already been booked/i);
  });

  // ── Successful booking ────────────────────────────────────────
  test('201 — books appointment and returns saved record', async () => {
    pool.connect.mockResolvedValueOnce(makeFakeClient(successClientResponses()));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toMatch(/booked successfully/i);

    const appt = res.body.appointment;
    expect(appt).toBeDefined();
    expect(appt.id).toBe(42);
    expect(appt.doctorId).toBe(1);
    expect(appt.doctorName).toBe('Dr. Priya Sharma');
    expect(appt.patientName).toBe('Arjun Kapoor');
    expect(appt.status).toBe('confirmed');
    expect(appt.startTime).toBeDefined();
    expect(appt.endTime).toBeDefined();
    expect(appt.createdAt).toBeDefined();

    // Ensure patientPhone is NOT in the response
    expect(JSON.stringify(res.body)).not.toMatch(/patientPhone/i);
    expect(JSON.stringify(res.body)).not.toMatch(/98765/);
  });

  // ── Phone not leaked in response ──────────────────────────────
  test('201 — response never contains patientPhone', async () => {
    pool.connect.mockResolvedValueOnce(makeFakeClient(successClientResponses()));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(201);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/patientPhone/i);
    expect(body).not.toMatch(/43210/);  // last 5 digits of phone
  });

  // ── Database error ────────────────────────────────────────────
  test('500 — db error rolls back and returns safe error', async () => {
    const dbError = Object.assign(new Error('FATAL: password auth failed'), { code: '28P01' });
    pool.connect.mockResolvedValueOnce(makeFakeClient([
      { rows: [], rowCount: 0 },  // BEGIN
      dbError                     // doctor query throws
    ]));
    const res = await request(app).post('/api/appointments').send(VALID_BODY);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe('error');
    // No credentials or password in response
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres:\/\//i);
  });

  // ── Concurrent booking simulation ────────────────────────────
  // Simulates two simultaneous POST requests for the same slot.
  // Request A succeeds (gets the FOR UPDATE lock, finds no conflict, inserts).
  // Request B arrives slightly later — by the time its conflict check runs,
  // the slot is already taken → gets 409.
  test('409 — concurrent request loses the race (slot taken by the time conflict check runs)', async () => {
    // Request A: full success path
    pool.connect.mockResolvedValueOnce(makeFakeClient(successClientResponses()));

    // Request B: availability window found (passes step 4), but conflict check
    // finds the row already committed by A → 409
    pool.connect.mockResolvedValueOnce(makeFakeClient([
      { rows: [], rowCount: 0 },            // BEGIN
      DB_DOCTOR_ROW,                        // doctor found
      DB_AVAIL_ROW,                         // availability FOR UPDATE (A already committed)
      { rows: [{ id: 42 }], rowCount: 1 }  // conflict: A's appointment exists
    ]));

    // Fire both concurrently
    const [resA, resB] = await Promise.all([
      request(app).post('/api/appointments').send(VALID_BODY),
      request(app).post('/api/appointments').send(VALID_BODY)
    ]);

    // One must succeed, one must get 409
    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
