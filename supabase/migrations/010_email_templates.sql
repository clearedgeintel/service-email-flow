-- ============================================================
-- Migration 010: Email template editor
-- Admin-editable templates for LLM prompts, followups, and fallback replies.
-- Variables use {{var_name}} syntax, substituted at render time.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  description  TEXT,
  subject      TEXT,
  body         TEXT NOT NULL,
  body_format  TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'markdown' | 'system_prompt'
  variables    TEXT[] NOT NULL DEFAULT '{}',   -- list of supported {{vars}}
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_email_templates_updated
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed defaults — these mirror the hardcoded values today so behavior
-- is unchanged until an admin edits them.

INSERT INTO email_templates (key, label, description, subject, body, body_format, variables) VALUES
(
  'composer_system_prompt',
  'AI Reply — System Instructions',
  'Instructions sent to Claude when generating customer replies. Affects tone, length, and content rules. The LLM still writes the actual reply creatively — this shapes how.',
  NULL,
  'You are writing a customer reply email on behalf of "{{business_name}}".

RULES:
- Be polite, professional, warm, and concise.
- Start with a greeting using the customer''s first name if available.
- Briefly summarize what you understood about their request (1-2 sentences).
- If there are things you need clarified, ask 1-3 SPECIFIC questions (not generic).
- If this is an EMERGENCY: lead with safety instructions FIRST.
- Keep it under 200 words (the HTML template handles formatting, signature, buttons).
- Return ONLY the email body paragraphs as plain text. NO subject line, NO signature, NO HTML, NO markdown.
- Separate paragraphs with a blank line.
- Do NOT include the booking link as a URL — just write a sentence like "Click the button below to book your appointment" or "Use the link below to schedule."
- Do NOT include the business name/phone sign-off — the template handles that.
- Be human and warm, not robotic.
- Never make promises about timing you can''t keep.',
  'system_prompt',
  ARRAY['business_name']
),
(
  'fallback_reply_emergency',
  'Fallback Reply — Emergency',
  'Used when the LLM is unavailable AND the case is an emergency. Customer-facing plain text. Wrapped by the branded HTML template.',
  NULL,
  'Hi {{customer_name}},

Thank you for reaching out. We understand this is urgent and are treating it as a priority.

If you are in any immediate danger, please call 911 first. For gas leaks, leave the building immediately and do not use any light switches or electronics.

A technician from {{business_name}} will contact you within 15 minutes. You can also reach us directly at {{business_phone}}.

Click the button below to confirm your emergency appointment.',
  'text',
  ARRAY['customer_name', 'business_name', 'business_phone']
),
(
  'fallback_reply_standard',
  'Fallback Reply — Standard',
  'Used when the LLM is unavailable for non-emergency cases. Plain text wrapped by the HTML template.',
  NULL,
  'Hi {{customer_name}},

Thank you for contacting {{business_name}} about {{problem_summary}}. We''ve received your message and want to help.

To get started, click the button below to schedule a convenient time, or call us directly at {{business_phone}}.

We look forward to assisting you!',
  'text',
  ARRAY['customer_name', 'business_name', 'business_phone', 'problem_summary']
),
(
  'followup_first',
  'Follow-up #1 (after initial reply)',
  'Sent to customers who received a reply but haven''t booked within the first follow-up delay.',
  'Following up on your {{trade}} request — {{business_name}}',
  'Hi {{customer_name}},

Just checking in! We received your request about {{problem_summary}} and wanted to make sure you were able to book an appointment.

You can schedule at your convenience here:
{{calcom_url}}

Or if you''d prefer, give us a call at {{business_phone}} and we''ll get you set up right away.

Looking forward to helping!

—
{{business_name}}
{{business_phone}}',
  'text',
  ARRAY['customer_name', 'business_name', 'business_phone', 'trade', 'problem_summary', 'calcom_url']
),
(
  'followup_second',
  'Follow-up #2 (last attempt)',
  'Sent as the final follow-up before the case is escalated to manual call list.',
  'One more follow-up — {{business_name}}',
  'Hi {{customer_name}},

We wanted to follow up one more time on your {{trade}} request. We''d love to help!

Book here: {{calcom_url}}
Or call us: {{business_phone}}

If you''ve already resolved the issue or no longer need service, no worries at all — just let us know and we''ll close out your request.

Best,
{{business_name}}
{{business_phone}}',
  'text',
  ARRAY['customer_name', 'business_name', 'business_phone', 'trade', 'calcom_url']
)
ON CONFLICT (key) DO NOTHING;
