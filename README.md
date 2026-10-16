# CarePoint — AI Voice Appointment Booking

CarePoint is a healthcare appointment booking application with a React frontend, Node.js/Express backend, Supabase PostgreSQL database, and Retell AI voice assistant.

## Features

- View available doctors and specialties.
- Check appointment availability for a selected date.
- Book appointments through the web interface.
- Interact with the Retell AI voice assistant.
- Store confirmed appointments in Supabase.
- Validate appointment requests and handle booking conflicts.

## Architecture

1. **Frontend:** React and Vite, deployed on Vercel.
2. **Backend:** Node.js and Express, deployed on Render.
3. **Database:** Supabase PostgreSQL stores doctors, availability, and appointments.
4. **Voice agent:** Retell AI uses a prompt and custom functions to retrieve doctors, check availability, and book appointments.
5. **Database schema:** `schema.sql` documents the tables and includes a PostgreSQL exclusion constraint intended to prevent overlapping confirmed appointments.

## API Endpoints

- `GET /api/doctors` — retrieve doctors.
- `GET /api/availability?doctorId=1&date=YYYY-MM-DD` — check availability.
- `POST /api/appointments` — request an appointment booking.
- `GET /api/health` — check backend health.
- `GET /api/db-health` — check database connectivity.

## Setup

### Requirements

- Node.js and npm
- A Supabase project
- A Retell AI account for voice assistant functionality

### Backend

1. Open a terminal in the `backend` directory.
2. Run `npm install`.
3. Create a local `.env` file using `.env.example` as a reference.
4. Add the required Supabase configuration.
5. Run the backend using the script defined in `backend/package.json`.

### Frontend

1. Open a terminal in the `frontend` directory.
2. Run `npm install`.
3. Configure the backend API URL.
4. Run `npm run dev` to start the development server.
5. Run `npm run build` to verify the production build.

Never commit `.env` files, database passwords, or private API keys.

## Evaluation

The evaluation harness is located in `evals/`. It should cover doctor selection, unavailable dates, confirmation before booking, booking conflicts, and backend errors. See the evaluation scripts for the scenarios currently implemented.

## Design Tradeoffs

- **Retell AI:** Provides voice interaction without building a speech pipeline from scratch.
- **Express:** Keeps the backend API small and straightforward.
- **Supabase:** Provides managed PostgreSQL storage.
- **Server-side booking validation:** Prevents the frontend alone from deciding whether a booking succeeded.
- **Database exclusion constraint:** Provides a stronger concurrency safeguard than application-level checks alone. The constraint must be applied and verified in the actual database before claiming this protection is active.

## Deployment

- Frontend: https://care-voice-agent.vercel.app/
- Backend: https://care-voice-agent.onrender.com

## Evidence and Limitations

A successful booking was tested through the web application and stored in Supabase. Retell function tests were also performed for doctor retrieval, availability checking, and booking.

Add a redacted call transcript or recording reference, booking log, and evaluation results file when available. Do not publish patient phone numbers or other personal information.

The current demo uses sample doctor and availability data. It is a prototype, not a production-ready medical system.
