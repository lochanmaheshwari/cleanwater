-- cleanwater.lol schema
create extension if not exists "pgcrypto";

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  destination text unique,
  display_name text,
  description text,
  logo_path text,
  category text,
  total_bid_cents int default 0,
  donated_cents int default 0,
  click_count int default 0,
  donation_confirmed boolean default false,
  payment_confirmed boolean default false,
  everyorg_donation_id text,
  payment_id text,
  status text default 'awaiting_donation',
  first_bid_at timestamptz default now(),
  last_bid_at timestamptz default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id) on delete cascade,
  amount_cents int not null,
  donated_cents int,
  everyorg_donation_id text unique,
  payment_id text unique,
  created_at timestamptz default now()
);

create table if not exists clicks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id) on delete cascade,
  created_at timestamptz default now(),
  referrer text
);

create table if not exists site_stats (
  id int primary key default 1,
  visitor_count int default 0,
  launched_at timestamptz default now()
);
insert into site_stats (id, visitor_count) values (1, 0) on conflict (id) do nothing;

-- ranking index
create index if not exists entries_live_rank on entries (total_bid_cents desc, first_bid_at asc) where status='live';
create index if not exists bids_created on bids (created_at desc);
create index if not exists entries_slug on entries (slug);
create index if not exists entries_destination on entries (destination);

-- storage bucket for logos (create via dashboard or uncomment if supabase storage schema accessible)
-- insert into storage.buckets (id, name, public) values ('logos','logos', true) on conflict (id) do nothing;

-- RLS
alter table entries enable row level security;
alter table bids enable row level security;
alter table site_stats enable row level security;
alter table clicks enable row level security;

drop policy if exists "public read live" on entries;
create policy "public read live" on entries for select using (status = 'live');

drop policy if exists "public read" on bids;
create policy "public read" on bids for select using (true);

drop policy if exists "public read" on site_stats;
create policy "public read" on site_stats for select using (true);

drop policy if exists "public insert" on clicks;
create policy "public insert" on clicks for insert with check (true);

-- new columns for two-step PayPal + Every.org flow (Part 2)
alter table entries
  add column if not exists bid_cents          int,
  add column if not exists platform_cents     int,
  add column if not exists donation_cents     int,
  add column if not exists paypal_order_id    text unique,
  add column if not exists paypal_capture_id  text,
  add column if not exists everyorg_charge_id text unique,
  add column if not exists paid_at            timestamptz,
  add column if not exists donated_at         timestamptz,
  add column if not exists logo_status        text default 'pending';

-- ensure status allows new states: pending | paid | live | voided | refund_failed | needs_review
-- existing 'awaiting_donation' rows remain valid; new rows use the new states

-- logos bucket: public read, no public write (writes via signed URL)
insert into storage.buckets (id, name, public) values ('logos','logos', true) on conflict (id) do nothing;

create policy if not exists "logos public read" on storage.objects for select using (bucket_id = 'logos');
-- no public insert/update/delete — only service role via signed URL

-- seed: one listing at #1, $5, live
insert into entries (slug, destination, display_name, description, category, total_bid_cents, donated_cents, donation_confirmed, payment_confirmed, status)
values ('hello-water','https://example.com','Hello Water','An example to be outbid. Replace me.', 'AI tools', 500, 375, true, true, 'live')
on conflict (destination) do nothing;

insert into bids (entry_id, amount_cents, donated_cents)
select id, 500, 375 from entries where slug='hello-water'
on conflict do nothing;

-- UroPay UPI for India (savewater.tech normal flow)
alter table entries
  add column if not exists uropay_order_id text,
  add column if not exists uropay_utr text,
  add column if not exists uropay_last_status text;
create index if not exists entries_uropay_order_id on entries (uropay_order_id);
