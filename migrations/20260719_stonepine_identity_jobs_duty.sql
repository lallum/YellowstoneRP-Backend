-- StonePineRP Glenwood integration migration
-- Safe to run more than once. It extends the existing YellowstoneRP schema without renaming it.

BEGIN;

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS biography text NOT NULL DEFAULT '';

ALTER TABLE public.job_sessions
  ADD COLUMN IF NOT EXISTS server_id text,
  ADD COLUMN IF NOT EXISTS station_key text,
  ADD COLUMN IF NOT EXISTS clock_out_reason text;

ALTER TABLE public.online_players
  ADD COLUMN IF NOT EXISTS current_job_key text NOT NULL DEFAULT 'unemployed';

CREATE TABLE IF NOT EXISTS public.character_name_change_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  old_first_name text NOT NULL,
  old_last_name text NOT NULL,
  requested_first_name text NOT NULL,
  requested_last_name text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  CONSTRAINT character_name_change_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

ALTER TABLE public.character_name_change_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_character_name_changes_character
  ON public.character_name_change_requests(character_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_character_name_change_pending
  ON public.character_name_change_requests(character_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_sessions_character_status
  ON public.job_sessions(character_id, status, started_at DESC);

-- Resolve any legacy duplicate active shifts before enforcing one active shift per character.
WITH ranked_active AS (
  SELECT id, row_number() OVER (PARTITION BY character_id ORDER BY started_at DESC, id DESC) AS rn
  FROM public.job_sessions
  WHERE status = 'active'
)
UPDATE public.job_sessions js
SET status = 'cancelled', finished_at = COALESCE(js.finished_at, now()), clock_out_reason = 'migration_duplicate_cleanup'
FROM ranked_active r
WHERE js.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_sessions_one_active_per_character
  ON public.job_sessions(character_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_job_sessions_server_active
  ON public.job_sessions(server_id, started_at DESC)
  WHERE status = 'active';

INSERT INTO public.job_definitions(job_key, display_name, payout_per_unit_cents, max_payout_cents, whitelisted, active)
VALUES
  ('unemployed', 'Unemployed', 0, 0, false, true),
  ('taxi', 'Taxi Driver', 250, 50000, false, true),
  ('bus', 'Bus Driver', 250, 50000, false, true),
  ('towing', 'Tow Operator', 500, 75000, false, true),
  ('mechanic', 'Auto Mechanic', 500, 75000, false, true),
  ('delivery', 'Delivery Driver', 300, 60000, false, true),
  ('pizza', 'Pizza Delivery Driver', 200, 40000, false, true),
  ('trucking', 'Truck Driver', 750, 100000, false, true),
  ('lawyer', 'Lawyer', 1000, 150000, false, true),
  ('police', 'StonePine Police Officer', 1000, 150000, true, true),
  ('fire', 'StonePine Firefighter', 1000, 150000, true, true),
  ('ems', 'StonePine EMS', 1000, 150000, true, true),
  ('prison', 'StonePine Corrections Officer', 1000, 150000, true, true)
ON CONFLICT(job_key) DO UPDATE SET
  display_name = excluded.display_name,
  payout_per_unit_cents = excluded.payout_per_unit_cents,
  max_payout_cents = excluded.max_payout_cents,
  whitelisted = excluded.whitelisted,
  active = excluded.active;

INSERT INTO public.duty_stations(station_key, display_name, duty_role, active)
VALUES
  ('SP_POLICE_MAIN', 'StonePine Police Duty Desk', 'police', true),
  ('SP_FIRE_MAIN', 'StonePine Fire Duty Desk', 'fire', true),
  ('SP_EMS_MAIN', 'StonePine EMS Duty Desk', 'ems', true),
  ('SP_PRISON_MAIN', 'StonePine Prison Duty Desk', 'prison', true)
ON CONFLICT(station_key) DO UPDATE SET
  display_name = excluded.display_name,
  duty_role = excluded.duty_role,
  active = excluded.active,
  updated_at = now();

COMMIT;
