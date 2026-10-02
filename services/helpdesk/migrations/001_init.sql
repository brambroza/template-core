-- Helpdesk: categories with SLA, tickets with comments, canned replies, knowledge base.
-- Users (requester / assignee / author) are stored as snapshots (id + name), never joined to identity.

create table categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  sla_response_hours numeric(8,2) not null default 4 check (sla_response_hours > 0),
  sla_resolve_hours numeric(8,2) not null default 24 check (sla_resolve_hours > 0),
  default_assignee_id uuid,
  default_assignee_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant categories

create table tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  title text not null,
  description text,
  requester_name text,
  requester_contact text,
  channel text not null default 'web' check (channel in ('web', 'phone', 'line', 'email', 'walk_in')),
  category_id uuid references categories(id),
  category_name text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid,
  assignee_name text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  response_due_at timestamptz not null,
  due_at timestamptz not null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  closed_at timestamptz,
  satisfaction int check (satisfaction between 1 and 5),
  feedback text,
  reopen_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant tickets
create index tickets_status on tickets (tenant_id, status);
create index tickets_assignee_open on tickets (tenant_id, assignee_id) where status not in ('resolved', 'closed');

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ticket_id uuid not null references tickets(id) on delete cascade,
  internal boolean not null default false,
  body text not null,
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now()
);
-- @tenant ticket_comments
create index ticket_comments_ticket on ticket_comments (ticket_id, created_at);

create table canned_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null,
  body text not null,
  category_id uuid references categories(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- @tenant canned_replies

create table kb_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null,
  body text not null,
  category_id uuid references categories(id) on delete set null,
  published boolean not null default false,
  published_at timestamptz,
  views int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- @tenant kb_articles
