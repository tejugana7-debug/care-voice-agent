
const BASE_URL =
    process.env.API_BASE_URL ||
    "https://care-voice-agent.onrender.com";

const results = [];

async function evaluate(name, test) {
    try {
        await test();
        results.push({ name, passed: true });
        console.log(`PASS: ${name}`);
    } catch (error) {
        results.push({ name, passed: false });
        console.error(`FAIL: ${name} — ${error.message}`);
    }
}

async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return { response, data };
}

async function main() {
    // Eval 1: The agent's doctor lookup tool has a working API.
    await evaluate("Doctor lookup succeeds", async () => {
        const { response, data } = await request("/api/doctors");

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const body = JSON.stringify(data);
        if (!body.includes("Priya Sharma")) {
            throw new Error("Expected demo doctor not found");
        }
    });

    // Eval 2: Availability returns structured results.
    await evaluate("Availability returns slots", async () => {
        const { response, data } = await request(
            "/api/availability?doctorId=1&date=2026-10-20"
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (data.status !== "ok") throw new Error("Status is not ok");
        if (!Array.isArray(data.availableSlots)) {
            throw new Error("availableSlots is not an array");
        }
    });

    // Eval 3: Invalid input must not be accepted.
    await evaluate("Invalid date is rejected", async () => {
        const { response } = await request(
            "/api/availability?doctorId=1&date=not-a-date"
        );

        if (response.ok) throw new Error("Invalid date was accepted");
    });

    // Eval 4: Missing doctor ID must be rejected.
    await evaluate("Missing doctor ID is rejected", async () => {
        const { response } = await request(
            "/api/availability?date=2026-10-20"
        );

        if (response.ok) throw new Error("Missing doctor ID was accepted");
    });

    // Eval 5: Booking without explicit confirmation must fail.
    // This should not create an appointment.
    await evaluate("Unconfirmed booking is rejected", async () => {
        const { response } = await request("/api/appointments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                doctorId: 1,
                patientName: "Eval Test",
                patientPhone: "0000000000",
                startTime: "2026-10-20T12:00:00.000Z",
                endTime: "2026-10-20T12:30:00.000Z",
                confirmed: false
            })
        });

        if (response.ok) {
            throw new Error("Unconfirmed booking was accepted");
        }
    });

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    console.log(`\nEval summary: ${passed}/${results.length} passed`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
