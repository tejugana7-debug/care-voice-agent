
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HeartPulse,
  LoaderCircle,
  Phone,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import "./App.css";

const API = "https://care-voice-agent.onrender.com";

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function App() {
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(localDate());
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    async function loadDoctors() {
      try {
        const response = await fetch(`${API}/api/doctors`);
        if (!response.ok) throw new Error("Could not load doctors.");
        const data = await response.json();
        const list = Array.isArray(data) ? data : data.doctors || [];
        const activeDoctors = list.filter((doctor) => doctor.active !== false);
        setDoctors(activeDoctors);
        if (activeDoctors.length) setDoctorId(String(activeDoctors[0].id));
      } catch {
        setError("Unable to load doctors. Please refresh the page and try again.");
      } finally {
        setLoadingDoctors(false);
      }
    }
    loadDoctors();
  }, []);

  useEffect(() => {
    if (!doctorId || !date) return;

    let cancelled = false;

    async function loadSlots() {
      setLoadingSlots(true);
      setSlots([]);
      setSelectedSlot(null);
      setError("");

      try {
        const params = new URLSearchParams({
          doctorId: String(doctorId),
          date,
        });
        const response = await fetch(`${API}/api/availability?${params}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Could not check availability.");
        }

        if (!cancelled) {
          setSlots(
            (data.availableSlots || []).map((slot) => ({
              startTime: slot.start || slot.startTime,
              endTime: slot.end || slot.endTime,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load available times.");
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    }

    loadSlots();
    return () => {
      cancelled = true;
    };
  }, [doctorId, date]);

  async function handleBooking(event) {
    event.preventDefault();
    setError("");

    if (!selectedSlot) {
      setError("Please select an available time.");
      return;
    }

    if (!/^\d{10}$/.test(phone.trim())) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }

    const doctor = doctors.find((item) => String(item.id) === doctorId);

    const confirmed = window.confirm(
      `Confirm appointment?\n\nDoctor: ${doctor?.name}\nDate: ${date}\nTime: ${formatTime(selectedSlot.startTime)}\nPatient: ${name.trim()}\nPhone: ${phone.trim()}`,
    );

    if (!confirmed) return;

    setBooking(true);

    try {
      const response = await fetch(`${API}/api/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId: Number(doctorId),
          patientName: name.trim(),
          patientPhone: phone.trim(),
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          confirmed: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
          (response.status === 409
            ? "That slot has just been booked. Please choose another."
            : "Booking failed. Please try again."),
        );
      }

      setSuccess({
        doctor: doctor?.name,
        specialty: doctor?.specialty,
        date,
        time: formatTime(selectedSlot.startTime),
        patient: name.trim(),
        phone: phone.trim(),
      });
      setSelectedSlot(null);
      setName("");
      setPhone("");
    } catch (err) {
      setError(err.message || "Unable to book the appointment.");
    } finally {
      setBooking(false);
    }
  }

  function resetBooking() {
    setSuccess(null);
    setError("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="CarePoint home">
          <span className="brand-icon"><HeartPulse size={25} /></span>
          <span>Care<span className="brand-accent">Point</span></span>
        </a>
        <nav className="nav-links">
          <a href="#home">Home</a>
          <a href="#doctors">Our Doctors</a>
          <a href="#booking">Appointments</a>
        </nav>
        <a className="nav-cta" href="#booking">Book a Visit <ArrowRight size={16} /></a>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <div className="eyebrow"><span className="status-dot" /> YOUR HEALTH, OUR PRIORITY</div>
            <h1>Healthcare that<br />puts <span>you first.</span></h1>
            <p>
              Quality care starts with the right appointment. Find your doctor,
              choose a convenient time, and let us take care of the rest.
            </p>
            <div className="hero-actions">
              <a className="primary-btn" href="#booking">Book an appointment <ArrowRight size={18} /></a>
              <a className="text-link" href="#doctors">Meet our doctors</a>
            </div>
            <div className="trust-row">
              <div className="trust-icon"><ShieldCheck size={21} /></div>
              <div><strong>Care you can trust</strong><span>Simple, secure appointment booking</span></div>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-illustration">
              <div className="illustration-cross">+</div>
              <div className="illustration-heart"><HeartPulse size={100} strokeWidth={1.4} /></div>
              <div className="illustration-label label-top"><span className="label-icon"><Activity size={18} /></span><div><strong>Personalized care</strong><small>Focused on you</small></div></div>
              <div className="illustration-label label-bottom"><span className="label-icon green"><CheckCircle2 size={18} /></span><div><strong>Easy scheduling</strong><small>Choose your own time</small></div></div>
            </div>
          </div>
        </section>

        <section className="stats-strip" aria-label="Our care features">
          <div><span className="stat-icon"><Stethoscope /></span><div><strong>Trusted doctors</strong><small>Professional care</small></div></div>
          <div><span className="stat-icon"><CalendarDays /></span><div><strong>Easy scheduling</strong><small>Choose your time</small></div></div>
          <div><span className="stat-icon"><Clock3 /></span><div><strong>Quick booking</strong><small>Just a few steps</small></div></div>
          <div><span className="stat-icon"><Users /></span><div><strong>Patient first</strong><small>Your care matters</small></div></div>
        </section>

        <section className="doctors-section section-wrap" id="doctors">
          <div className="section-heading">
            <div><span className="eyebrow">MEET YOUR CARE TEAM</span><h2>Find the right doctor</h2><p>Choose a specialist to get started with your appointment.</p></div>
            <a className="text-link" href="#booking">Book a visit <ArrowRight size={16} /></a>
          </div>

          {loadingDoctors ? (
            <div className="loading-state"><LoaderCircle className="spin" /> Loading our doctors…</div>
          ) : doctors.length === 0 ? (
            <div className="empty-state">Doctors could not be loaded. Check that the backend is running.</div>
          ) : (
            <div className="doctor-grid">
              {doctors.map((doctor, index) => (
                <article className={`doctor-card ${String(doctor.id) === doctorId ? "doctor-selected" : ""}`} key={doctor.id}>
                  <div className={`doctor-avatar avatar-${index % 3}`}><Stethoscope size={32} /></div>
                  <span className="doctor-badge">AVAILABLE FOR BOOKING</span>
                  <h3>{doctor.name}</h3>
                  <p>{doctor.specialty}</p>
                  <button className="doctor-select-btn" onClick={() => { setDoctorId(String(doctor.id)); document.querySelector("#booking")?.scrollIntoView({ behavior: "smooth" }); }}>
                    Select doctor <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="booking-section" id="booking">
          <div className="booking-intro">
            <span className="eyebrow">YOUR NEXT STEP TO BETTER HEALTH</span>
            <h2>Let's get you<br /><span>scheduled.</span></h2>
            <p>Pick your doctor, find a suitable time, and tell us how to reach you. Your appointment is confirmed only after the booking succeeds.</p>
            <div className="booking-note"><ShieldCheck size={20} /><span>Your details are used to manage your appointment.</span></div>
          </div>

          <div className="booking-card">
            {success ? (
              <div className="success-panel">
                <div className="success-icon"><CheckCircle2 size={38} /></div>
                <span className="eyebrow">BOOKING CONFIRMED</span>
                <h2>You're all set!</h2>
                <p>Your appointment has been successfully booked.</p>
                <div className="confirmation-details">
                  <div><span>Doctor</span><strong>{success.doctor}</strong><small>{success.specialty}</small></div>
                  <div><span>Date & time</span><strong>{success.date}</strong><small>{success.time}</small></div>
                  <div><span>Patient</span><strong>{success.patient}</strong><small>{success.phone}</small></div>
                </div>
                <button className="primary-btn full-btn" onClick={resetBooking}>Book another appointment <ArrowRight size={17} /></button>
              </div>
            ) : (
              <form onSubmit={handleBooking}>
                <div className="form-heading"><span className="form-step">01</span><div><h3>Book your appointment</h3><p>Complete the details below.</p></div></div>

                {error && <div className="error-message" role="alert">{error}</div>}

                <label htmlFor="doctor">Select doctor</label>
                <div className="input-wrap"><Stethoscope size={18} /><select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required disabled={loadingDoctors || !doctors.length}><option value="">Choose a doctor</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} — {doctor.specialty}</option>)}</select></div>

                <label htmlFor="date">Appointment date</label>
                <div className="input-wrap"><CalendarDays size={18} /><input id="date" type="date" min={localDate()} value={date} onChange={(e) => setDate(e.target.value)} required /></div>

                <div className="slots-heading"><label>Available times</label>{loadingSlots && <span className="small-loading"><LoaderCircle size={14} className="spin" /> Checking</span>}</div>
                {loadingSlots ? (
                  <div className="slot-placeholder">Finding available appointments…</div>
                ) : slots.length ? (
                  <div className="slot-grid">
                    {slots.map((slot, index) => {
                      const key = `${slot.startTime}-${slot.endTime}`;
                      return <button type="button" className={`slot-btn ${selectedSlot && selectedSlot.startTime === slot.startTime ? "slot-active" : ""}`} key={key || index} onClick={() => setSelectedSlot(slot)}>{formatTime(slot.startTime)}</button>;
                    })}
                  </div>
                ) : (
                  <div className="slot-placeholder">{doctorId && date ? "No available times for this date. Try another date." : "Choose a doctor and date to see available times."}</div>
                )}

                <div className="form-divider"><span className="form-step">02</span><div><h3>Your details</h3><p>Who is the appointment for?</p></div></div>

                <label htmlFor="patientName">Full name</label>
                <div className="input-wrap"><UserRound size={18} /><input id="patientName" type="text" placeholder="Enter your full name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></div>

                <label htmlFor="phone">Phone number</label>
                <div className="input-wrap"><Phone size={18} /><input id="phone" type="tel" inputMode="numeric" placeholder="10-digit phone number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} required /></div>

                <button className="primary-btn full-btn" type="submit" disabled={booking || loadingSlots || !selectedSlot || !name.trim() || phone.length !== 10}>
                  {booking ? <><LoaderCircle size={18} className="spin" /> Booking appointment…</> : <>Confirm appointment <ArrowRight size={18} /></>}
                </button>
                <p className="form-footnote"><ShieldCheck size={15} /> You'll review the details before the booking is submitted.</p>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#home"><span className="brand-icon"><HeartPulse size={22} /></span><span>Care<span className="brand-accent">Point</span></span></a>
        <p>Thoughtful care. Easier appointments.</p>
        <span>© {new Date().getFullYear()} CarePoint Clinic</span>
      </footer>
    </div>
  );
}

export default App;
