export interface EmailTemplateParams {
  bodyHtml: string;
  businessName: string;
  businessPhone: string;
  businessUrl: string;
  businessLocation: string;
  ctaUrl: string;
  ctaLabel: string;
  isEmergency: boolean;
  pricingHtml?: string;
}

export function buildHtmlEmail(params: EmailTemplateParams): string {
  const {
    bodyHtml,
    businessName,
    businessPhone,
    businessUrl,
    businessLocation,
    ctaUrl,
    ctaLabel,
    isEmergency,
    pricingHtml,
  } = params;

  const ctaColor = isEmergency ? '#dc2626' : '#1a73e8';

  const emergencyBanner = isEmergency
    ? `<div style="background:#dc2626;color:#ffffff;padding:16px 20px;border-radius:8px;margin:0 0 24px 0;">
        <p style="margin:0;font-size:16px;font-weight:700;">⚠️ EMERGENCY RESPONSE</p>
        <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;">A technician will contact you within 15 minutes. If you are in immediate danger, call 911 first.</p>
      </div>`
    : '';

  const ctaHtml = `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:${ctaColor};border-radius:8px;">
          <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;font-family:Arial,sans-serif;">
            📅 ${ctaLabel}
          </a>
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg, #1a73e8, #0d47a1);padding:28px 32px;border-radius:12px 12px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${businessName}</p>
                    <p style="margin:4px 0 0 0;font-size:14px;color:rgba(255,255,255,0.85);">Licensed &amp; Insured &bull; ${businessLocation}</p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <a href="tel:${businessPhone.replace(/\D/g, '')}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">📞 ${businessPhone}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#ffffff;padding:32px;">
              ${emergencyBanner}
              ${bodyHtml}
              ${pricingHtml || ''}
              <div style="text-align:center;">
                ${ctaHtml}
                <p style="margin:0;font-size:14px;color:#666;">Or call us directly at <a href="tel:${businessPhone.replace(/\D/g, '')}" style="color:#1a73e8;font-weight:600;text-decoration:none;">${businessPhone}</a></p>
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f7f8fa;padding:24px 32px;border-top:1px solid #e8e8e8;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#333;">${businessName}</p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#777;">${businessLocation} &bull; <a href="${businessUrl}" style="color:#1a73e8;text-decoration:none;">${businessUrl.replace('https://', '')}</a></p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#777;">📞 ${businessPhone}</p>
              <p style="margin:16px 0 0 0;font-size:11px;color:#aaa;line-height:1.4;">This email was sent in response to your inquiry. If you did not contact us, please disregard this message.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPricingTableHtml(
  items: Array<{ service: string; price_min: number; price_max: number; unit: string }>,
): string {
  if (items.length === 0) return '';

  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eef0f3;font-size:14px;color:#333;">${item.service}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eef0f3;font-size:14px;color:#1a73e8;font-weight:600;text-align:right;white-space:nowrap;">$${item.price_min} – $${item.price_max}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eef0f3;font-size:13px;color:#777;text-align:right;">${item.unit}</td>
    </tr>`,
    )
    .join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e2e5ea;border-radius:8px;border-collapse:separate;overflow:hidden;">
      <tr style="background:#f7f8fa;">
        <th style="padding:10px 14px;text-align:left;font-size:13px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Service</th>
        <th style="padding:10px 14px;text-align:right;font-size:13px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Estimate</th>
        <th style="padding:10px 14px;text-align:right;font-size:13px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>
      </tr>
      ${rows}
    </table>
    <p style="margin:0 0 16px 0;font-size:13px;color:#888;line-height:1.5;">* Final pricing is always determined after an on-site diagnosis. No surprises – we confirm the price before starting any work.</p>`;
}
