-- Room & Vehicle Booking (จองห้องและรถ)

create table resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  kind text not null check (kind in ('room', 'vehicle', 'equipment')),
  capacity int check (capacity is null or capacity > 0),
  location text,
  plate_no text,
  requires_approval boolean not null default false,
  active boolean not null default true,
  color text,
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant resources

create table bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  resource_id uuid not null references resources(id),
  purpose text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  attendees int check (attendees is null or attendees > 0),
  destination text,
  -- requester snapshot (identity owns users; we keep what was shown at booking time)
  requester_id uuid,
  requester_name text not null,
  requester_department text,
  requester_phone text,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'rejected', 'completed')),
  approved_by uuid,
  approved_at timestamptz,
  decision_note text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  mileage_start numeric(12,1),
  mileage_end numeric(12,1),
  distance_km numeric(12,1),
  fuel_cost numeric(18,4),
  completion_note text,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  unique (tenant_id, no)
);
-- @tenant bookings
create index bookings_resource_time on bookings (resource_id, start_at, end_at);
create index bookings_start on bookings (start_at);
