-- 1. Admin audit log
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_reference text,
  action text NOT NULL,
  field text,
  old_value text,
  new_value text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins append audit log" ON public.admin_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND actor_id = auth.uid());

CREATE INDEX idx_admin_audit_log_created_at ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_entity ON public.admin_audit_log (entity_type, entity_id);

-- 2. Tracking detail on mock payout transfers
ALTER TABLE public.mock_payout_transfers
  ADD COLUMN IF NOT EXISTS partner_reference text,
  ADD COLUMN IF NOT EXISTS solana_tx_signature text,
  ADD COLUMN IF NOT EXISTS funded_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS timeline_note text;

UPDATE public.mock_payout_transfers
SET partner_reference = 'partner_mock_' || substr(replace(id::text, '-', ''), 1, 10),
    solana_tx_signature = 'MockSol' || substr(replace(id::text, '-', ''), 1, 24) || 'Demo',
    funded_at = created_at + interval '4 minutes'
WHERE partner_reference IS NULL;

UPDATE public.mock_payout_transfers
SET settled_at = created_at + interval '22 minutes'
WHERE payment_status = 'paid' AND settled_at IS NULL;

-- 3. Admin invites
CREATE TABLE public.admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role app_role NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_invites TO authenticated;
GRANT ALL ON public.admin_invites TO service_role;
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invites" ON public.admin_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_admin_invites_touch
  BEFORE UPDATE ON public.admin_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Admins may read all role rows (for the role management page)
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
