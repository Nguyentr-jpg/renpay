# Supabase Dev Loop (Renpay)

## Goal
- Keep app features and Supabase schema in sync.
- For every DB-related feature, always provide SQL migration steps for manual paste in Supabase SQL Editor.
- Keep a versioned schema snapshot in this file so future features do not drift from production.

## Connection Guardrails (must pass before coding DB features)
1. Set `DATABASE_URL` to the intended Supabase project.
2. Run:
   ```bash
   npm run db:check
   ```
3. Confirm:
   - printed DB host is the expected Supabase host/project
   - core tables are visible
   - required subscription columns exist
4. If `db:check` fails, fix env first. Do not continue DB feature work on unknown DB.

## Current Production Snapshot (2026-02-19)

### Core schema updates already applied
- `orders.client_email` added.
- `client_profiles` table added:
  - `id uuid` PK
  - `user_id uuid` FK -> `users.id`
  - `client_id varchar(100)` (unique per user)
  - `client_email varchar(255)` (unique per user, case-insensitive)
  - `client_name varchar(255)`
  - `created_at`, `updated_at`
- `subscriptions` plan constraint applied:
  - `ck_subscriptions_plan`
  - allowed values:
    - `personal_monthly`
    - `personal_annual`
    - `business_monthly`
    - `business_annual`
- `subscriptions` cancellation lifecycle columns expected:
  - `cancel_at_period_end boolean not null default false`
  - `canceled_at timestamptz null`
  - `cancel_reason text null`

## Current Known RLS Policies (from production export)

### `client_profiles`
- `Service role has full access to client_profiles` (`ALL`)
- `Users can view own client_profiles` (`SELECT` with `auth.uid() = user_id`)
- `Users can insert own client_profiles` (`INSERT` with `auth.uid() = user_id`)
- `Users can update own client_profiles` (`UPDATE` with `auth.uid() = user_id`)
- `Users can delete own client_profiles` (`DELETE` with `auth.uid() = user_id`)

### `files`
- `Service role has full access to files` (`ALL`)
- `Users can view own order files` (`SELECT` via `orders.user_id = auth.uid()`)

### `order_items`
- `Service role has full access to order_items` (`ALL`)
- `Users can create own order items` (`INSERT` with `EXISTS` on parent order ownership)
- `Users can view own order items` (`SELECT` with same ownership check)

### `orders`
- `Service role has full access to orders` (`ALL`)
- `Users can create own orders` (`INSERT` with `auth.uid() = user_id`)
- `Users can delete own orders` (`DELETE` with `auth.uid() = user_id`)
- `Users can update own orders` (`UPDATE` with `auth.uid() = user_id`)
- `Users can view own orders` (`SELECT` with `auth.uid() = user_id`)

### `payments`
- `Service role has full access to payments` (`ALL`)
- `Users can create own payments` (`INSERT` with `auth.uid() = user_id`)
- `Users can view own payments` (`SELECT` with `auth.uid() = user_id`)

### `users`
- `Service role has full access to users` (`ALL`)
- `Users can update own profile` (`UPDATE` with `auth.uid() = id`)
- `Users can view own profile` (`SELECT` with `auth.uid() = id`)

### `subscriptions`
- `Service role has full access to subscriptions` (`ALL`)
- `Users can view own subscriptions` (`SELECT` with `auth.uid() = user_id`)

### `referral_invites`
- `Service role has full access to referral_invites` (`ALL`)
- `Users can view own referral invites` (`SELECT` by `referrer_user_id = auth.uid()` or `invitee_email = jwt.email`)

### `wallets`
- `Service role has full access to wallets` (`ALL`)
- `Users can view own wallet` (`SELECT` with `auth.uid() = user_id`)

### `wallet_ledgers`
- `Service role has full access to wallet_ledgers` (`ALL`)
- `Users can view own wallet ledgers` (`SELECT` with `auth.uid() = user_id`)

## Required Workflow For Any DB-Related Feature
1. Define feature data contract first (new column/table/index/constraint/policy).
2. Generate SQL migration script with:
   - `BEGIN; ... COMMIT;`
   - idempotent checks where possible (`IF NOT EXISTS` / conditional `DO $$`)
   - rollback notes (`DROP` statements) if needed.
3. Share exact SQL block for Supabase SQL Editor.
4. Update API code to match new schema.
5. Add runtime fallback for old rows if migration not applied yet.
6. Verify RLS impact for `anon`, `authenticated`, and `service_role`.
7. Include a short post-migration verify query block.
8. Update this file with a new snapshot entry (date + changes).

## Snapshot Capture (run after each DB migration)
Use this SQL in Supabase SQL Editor and paste the result summary into this file:

```sql
-- Tables + columns
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- Constraints
select
  n.nspname as schema_name,
  t.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class t on t.oid = con.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by t.relname, con.conname;

-- Indexes
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- RLS policies
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## Standard Migration Template
```sql
BEGIN;

-- 1) Schema changes
-- ALTER TABLE ...
-- CREATE TABLE ...
-- CREATE INDEX ...

-- 2) Backfill if needed
-- UPDATE ...

-- 3) Constraints
-- ALTER TABLE ... ADD CONSTRAINT ...

-- 4) RLS/policies
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY ...

COMMIT;
```

## Standard Verify Template
```sql
-- Columns
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- Policies
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## Important Notes
- Future DB features must update this file with:
  - new/changed columns
  - new constraints/indexes
  - RLS/policy deltas
- This file is the default DB synchronization loop for future development in this repo.
- App-side DB verification command:
  - `npm run db:check`
