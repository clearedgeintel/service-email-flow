import { describe, it, expect } from 'vitest';
import { buildHtmlEmail, buildPricingTableHtml, EmailTemplateParams } from './email-template';

const baseParams: EmailTemplateParams = {
  bodyHtml: '<p>Thank you for contacting us.</p>',
  businessName: 'TestBiz Electric',
  businessPhone: '(555) 999-0000',
  businessUrl: 'https://testbiz.com',
  businessLocation: 'Austin, TX',
  ctaUrl: 'https://cal.com/testbiz/service',
  ctaLabel: 'Book a Service Call',
  isEmergency: false,
};

describe('buildHtmlEmail', () => {
  it('includes business name and phone', () => {
    const html = buildHtmlEmail(baseParams);
    expect(html).toContain('TestBiz Electric');
    expect(html).toContain('(555) 999-0000');
  });

  it('includes body content', () => {
    const html = buildHtmlEmail(baseParams);
    expect(html).toContain('Thank you for contacting us.');
  });

  it('includes CTA button with correct URL and label', () => {
    const html = buildHtmlEmail(baseParams);
    expect(html).toContain('https://cal.com/testbiz/service');
    expect(html).toContain('Book a Service Call');
  });

  it('shows emergency banner when isEmergency is true', () => {
    const html = buildHtmlEmail({ ...baseParams, isEmergency: true });
    expect(html).toContain('EMERGENCY RESPONSE');
    expect(html).toContain('#dc2626');
  });

  it('does not show emergency banner when isEmergency is false', () => {
    const html = buildHtmlEmail(baseParams);
    expect(html).not.toContain('EMERGENCY RESPONSE');
  });

  it('includes pricing HTML when provided', () => {
    const html = buildHtmlEmail({
      ...baseParams,
      pricingHtml: '<table><tr><td>Faucet Repair</td><td>$200</td></tr></table>',
    });
    expect(html).toContain('Faucet Repair');
  });

  it('includes business location and URL in footer', () => {
    const html = buildHtmlEmail(baseParams);
    expect(html).toContain('Austin, TX');
    expect(html).toContain('testbiz.com');
  });
});

describe('buildPricingTableHtml', () => {
  it('returns empty string for empty items', () => {
    expect(buildPricingTableHtml([])).toBe('');
  });

  it('renders pricing items with service names and prices', () => {
    const html = buildPricingTableHtml([
      { service: 'Outlet Install', price_min: 150, price_max: 300, unit: 'per outlet' },
      { service: 'Fan Install', price_min: 200, price_max: 450, unit: 'per fan' },
    ]);
    expect(html).toContain('Outlet Install');
    expect(html).toContain('$150');
    expect(html).toContain('$300');
    expect(html).toContain('per outlet');
    expect(html).toContain('Fan Install');
  });

  it('includes disclaimer text', () => {
    const html = buildPricingTableHtml([
      { service: 'Test', price_min: 100, price_max: 200, unit: 'per job' },
    ]);
    expect(html).toContain('Final pricing is always determined after an on-site diagnosis');
  });
});
