
const express = require('express');
const crypto = require('node:crypto');

const router = express.Router();

function verifyToolSecret(req, res, next) {
    const expected = process.env.RETELL_TOOL_SECRET;
    const received = req.get('x-tool-secret');

    if (!expected || !received) {
        return res.status(401).json({
            status: 'error',
            message: 'Unauthorized'
        });
    }

    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    if (
        expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
        return res.status(401).json({
            status: 'error',
            message: 'Unauthorized'
        });
    }

    next();
}

// Set this to your backend's base URL in production.
// Locally, it defaults to http://127.0.0.1:5000.
function getApiBaseUrl() {
    return (
        process.env.INTERNAL_API_BASE_URL ||
        `http://127.0.0.1:${process.env.PORT || 5000}`
    ).replace(/\/+$/, '');
}

async function forwardRequest(url, options, res) {
    try {
        const response = await fetch(url, options);
        const body = await response.json();

        return res.status(response.status).json(body);
    } catch (error) {
        console.error('[Retell webhook] Backend request failed');

        return res.status(502).json({
            status: 'error',
            message: 'Backend service could not be reached'
        });
    }
}

// Tool 1: get_doctors
router.post('/get_doctors', verifyToolSecret, async (req, res) => {
    const url = `${getApiBaseUrl()}/api/doctors`;

    return forwardRequest(url, {
        method: 'GET',
        headers: { Accept: 'application/json' }
    }, res);
});

// Tool 2: check_availability
router.post('/check_availability', verifyToolSecret, async (req, res) => {
    const { doctorId, date } = req.body || {};

    if (!doctorId || !date) {
        return res.status(400).json({
            status: 'error',
            message: 'doctorId and date are required'
        });
    }

    const params = new URLSearchParams({
        doctorId: String(doctorId),
        date: String(date)
    });

    const url =
        `${getApiBaseUrl()}/api/availability?${params.toString()}`;

    return forwardRequest(url, {
        method: 'GET',
        headers: { Accept: 'application/json' }
    }, res);
});

// Tool 3: book_appointment
router.post('/book_appointment', verifyToolSecret, async (req, res) => {
    const {
        doctorId,
        patientName,
        patientPhone,
        startTime,
        endTime,
        confirmed
    } = req.body || {};

    // Never let the adapter bypass explicit confirmation.
    if (confirmed !== true) {
        return res.status(400).json({
            status: 'error',
            message: 'Explicit patient confirmation is required'
        });
    }

    const url = `${getApiBaseUrl()}/api/appointments`;

    return forwardRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({
            doctorId,
            patientName,
            patientPhone,
            startTime,
            endTime,
            confirmed
        })
    }, res);
});

module.exports = router;
