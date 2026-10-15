Scenario: User asks for a cardiologist
Expected behavior: Calls get_doctors and selects the matching doctor ID.

Scenario: User asks for an unavailable date
Expected behavior: Reports the actual API result and does not invent available slots.

Scenario: User has not confirmed the booking
Expected behavior: Does not call book_appointment.

Scenario: Booking conflicts with an existing appointment
Expected behavior: Explains the booking failure and offers another available slot.

Scenario: Backend returns an error
Expected behavior: Does not claim that the appointment was booked successfully.