-- ============================================================
-- Migration 002: settings + pricing_items tables
-- Runtime-configurable business settings and service pricing
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default settings
INSERT INTO settings (key, value) VALUES
  ('business_name',           '"ProFix Electric & Plumbing"'),
  ('business_phone',          '"(555) 123-4567"'),
  ('business_url',            '"https://profixservice.com"'),
  ('business_location',       '"Fort Worth, TX"'),
  ('owner_email',             '""'),
  ('tech_email',              '""'),
  ('tech_phone',              '""'),
  ('confidence_threshold',    '0.70'),
  ('followup_delay_1_hours',  '4'),
  ('followup_delay_2_hours',  '24'),
  ('max_followups',           '2'),
  ('calcom_emergency_url',    '"https://cal.com/profix/emergency"'),
  ('calcom_service_url',      '"https://cal.com/profix/service-call"'),
  ('calcom_estimate_url',     '"https://cal.com/profix/free-estimate"'),
  ('slack_webhook_url',       '""'),
  ('digest_cron',             '"30 12 * * *"'),
  ('twilio_from_number',      '""')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_items (
  id          BIGSERIAL PRIMARY KEY,
  trade       TEXT NOT NULL,
  service     TEXT NOT NULL,
  keywords    TEXT[] NOT NULL,
  price_min   NUMERIC(10,2) NOT NULL,
  price_max   NUMERIC(10,2) NOT NULL,
  unit        TEXT DEFAULT 'per job',
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_pricing_items_updated
  BEFORE UPDATE ON pricing_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default pricing from WF4 hardcoded data
INSERT INTO pricing_items (trade, service, keywords, price_min, price_max, unit) VALUES
  ('electric', 'Standard Outlet Installation',         ARRAY['outlet','receptacle','plug','socket'],                              150, 300, 'per outlet'),
  ('electric', 'GFCI Outlet Installation',             ARRAY['gfci','ground fault','bathroom outlet','kitchen outlet'],           175, 350, 'per outlet'),
  ('electric', 'Ceiling Fan Installation',             ARRAY['ceiling fan','fan install','fan replacement'],                      200, 450, 'per fan'),
  ('electric', 'Breaker Panel Upgrade (100A to 200A)', ARRAY['breaker','panel','electrical panel','fuse box','200 amp'],          1800, 3500, 'per panel'),
  ('electric', 'Light Fixture Installation',           ARRAY['light','fixture','chandelier','sconce','lighting'],                 100, 250, 'per fixture'),
  ('electric', 'EV Charger Installation (Level 2)',    ARRAY['ev charger','electric vehicle','car charger','level 2','tesla'],    800, 2000, 'installed'),
  ('electric', 'Whole-House Rewire',                   ARRAY['rewire','knob and tube','aluminum wiring','whole house'],           8000, 20000, 'per home'),
  ('plumbing', 'Faucet Replacement',                   ARRAY['faucet','tap','sink faucet','kitchen faucet','bathroom faucet'],    175, 400, 'per faucet'),
  ('plumbing', 'Water Heater Replacement (40-50 gal)', ARRAY['water heater','hot water','no hot water','tank'],                   1200, 2500, 'installed'),
  ('plumbing', 'Tankless Water Heater Installation',   ARRAY['tankless','on-demand','instant hot water'],                         2500, 5000, 'installed'),
  ('plumbing', 'Drain Clearing / Clog Removal',        ARRAY['clog','drain','slow drain','backed up','blockage','clogged'],       150, 350, 'per drain'),
  ('plumbing', 'Toilet Replacement',                   ARRAY['toilet','commode','running toilet','toilet replacement'],            250, 600, 'per toilet'),
  ('plumbing', 'Sewer Line Repair/Replacement',        ARRAY['sewer','sewer line','main line','sewage','sewer backup'],            3000, 12000, 'per job'),
  ('plumbing', 'Garbage Disposal Installation',        ARRAY['garbage disposal','disposal','insinkerator'],                        250, 500, 'installed'),
  ('plumbing', 'Pipe Leak Repair',                     ARRAY['leak','pipe leak','dripping','water damage','burst pipe'],           200, 600, 'per repair');
