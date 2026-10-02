# booking — Room & Vehicle Booking (จองห้องและรถ) · feature

Staff book meeting rooms, company vehicles and shared equipment from phone or web; approvers handle resources that need approval;
drivers close a vehicle trip with odometer and fuel. Requires only `identity` (the requester is the token's user + a name snapshot taken from the token).

## Data
- `resources` (code, name, `room | vehicle | equipment`, capacity, location, plate_no, requires_approval, active, color, note)
- `bookings` (`BK-2569-0001`, resource, purpose, start_at/end_at (timestamptz), attendees, destination, requester_id + requester_name/department/phone snapshot,
  `pending → confirmed → completed`, exits `rejected | cancelled`, approval/cancel info (`approved_by_name`, `cancelled_by_name` from the token), vehicle `mileage_start/end`, `distance_km`, `fuel_cost` numeric(18,4))

## Behaviour
- "Booked by" = the token's name (`auth(req).userName`); a typed `requesterName` is ignored, except for users with `booking.book.approve`
  (a secretary booking on behalf of someone) or old tokens without a name. No name at all → 400. The form field is "จองแทนผู้อื่น" (optional).
- Local time is Asia/Bangkok (`src/time.ts`). `POST /bookings` takes `startAt`/`endAt` (ISO) or `date` + `startTime`/`endTime` (+ `endDate` for multi-day trips).
- `end > start` (400), max 31 days, `attendees ≤ capacity` (400 `ห้องประชุมเล็ก รับได้ 10 คน แต่ระบุผู้เข้าร่วม 12 คน`), inactive resource → 400.
- Overlap with a `pending` or `confirmed` booking of the same resource → **409** `… ถูกจองแล้วช่วง 1/3/2570 09:00–10:00 น. (BK-…: purpose — requester)`.
  Back-to-back slots are fine. The resource row is locked while booking, so concurrent requests cannot double-book.
- `requires_approval` → new bookings start `pending` (they already hold the slot); otherwise `confirmed`.
- approve/reject: `pending` only (perm `booking.book.approve`, reject needs a note). cancel: `pending | confirmed` and not yet ended.
  complete: `confirmed` and already started. Owners act on their own bookings with `booking.book.create`; approvers on anyone's.
- Completing a vehicle requires the end odometer; the start reading defaults to the vehicle's last `mileage_end`. `distance_km = end − start`.
  The odometer only goes up: the start reading may not be below the previous trip's end (by trip date) and the end may not pass the next trip's start (400); `lastMileage` = latest trip by date.
- `complete_mode` (`vehicle | other | null`) tells the UI which completion button to show.
- Utilisation = confirmed/completed hours this week (Mon–Sun, clipped) ÷ (45 h × active resources).

## API
- `GET /resources` (`q`, `kind`, `all=true`) · `POST /resources` · `GET /resources/:id` (upcoming, recent, month km/fuel, last mileage) · `PATCH /resources/:id`
- `GET /availability?date=&kind=&q=` — each active resource with that day's bookings, `slots`, `booked_hours`, `busy_now`
- `GET /bookings?from=&to=&resourceId=&kind=&status=&q=&mine=true` · `GET /bookings/mine` · `GET /bookings/pending` · `GET /bookings/:id`
- `POST /bookings` · `POST /bookings/:id/approve { note } | reject { note* } | cancel { reason } | complete { mileageStart, mileageEnd, fuelCost, note }`
- `GET /trips?month=YYYY-MM&resourceId=` — completed vehicle trips + per-vehicle km, fuel and fuel per km
- `GET /summary` — bookingsToday, pendingApproval, utilization %, bookedHoursWeek, kmMonth, months[6] {bookings, hours}, rows (upcoming)

Permissions: `booking.resource.read|write`, `booking.book.create|approve`.

## Events
- publishes `booking.requested` (bookingId, no, resourceName, startAt, endAt (ISO), requesterName, needsApproval, period (Thai text), purpose, requesterId) on every new booking.
- subscribes: none. Candidates (not added): `booking.decided` (tell the requester), `booking.trip_completed` (fuel cost to expense/costing).

## Screens
`src/ui.ts`: `board` (daily availability, mobile), `bookingNew` (mobile, resource lookup with QR scan), `myBookings`, `approvals` (approve/reject per row, mobile),
`bookingList`, `bookingDetail` (flow, printable, approve/reject/complete trip/complete/cancel), `trips` (monthly vehicle log), resources (+edit, detail with QR).
Widgets: kpi (today, pending, utilisation %, km), upcoming pipeline, booked-hours trend. ⌘K: `จองห้อง MR-1 …`, `จองรถ VAN-01 …`, `จองอุปกรณ์ …`, `ตารางห้อง`.

## Extension ideas
Recurring bookings (weekly meeting), check-in QR at the room door that releases no-shows, driver assignment, fuel receipts photo, calendar (ICS) feed.
