import { describe, it, expect } from 'vitest';
import { htmlToPlainText, buildRawEmail, isBusinessHours } from './email-builder';

describe('htmlToPlainText', () => {
  it('strips HTML tags', () => {
    const result = htmlToPlainText('<p>Hello <b>world</b></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('converts links to text with URL', () => {
    const result = htmlToPlainText('<a href="https://example.com">Click here</a>');
    expect(result).toContain('Click here');
    expect(result).toContain('https://example.com');
  });

  it('converts br tags to newlines', () => {
    const result = htmlToPlainText('Line 1<br>Line 2<br/>Line 3');
    expect(result).toContain('Line 1\nLine 2\nLine 3');
  });

  it('decodes HTML entities', () => {
    const result = htmlToPlainText('Tom &amp; Jerry &bull; Friends');
    expect(result).toContain('Tom & Jerry');
    expect(result).toContain('•');
  });

  it('collapses excessive whitespace', () => {
    const result = htmlToPlainText('<p>A</p><p>B</p><p>C</p>');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('handles empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('buildRawEmail', () => {
  it('builds plain text email with List-Unsubscribe header', () => {
    const raw = buildRawEmail({
      to: 'user@example.com',
      from: 'service@biz.com',
      subject: 'Test',
      text: 'Hello world',
    });

    // Decode and check headers
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded).toContain('To: user@example.com');
    expect(decoded).toContain('From: service@biz.com');
    expect(decoded).toContain('Subject: Test');
    expect(decoded).toContain('List-Unsubscribe:');
    expect(decoded).toContain('List-Unsubscribe-Post:');
  });

  it('builds multipart email with HTML and plain text', () => {
    const raw = buildRawEmail({
      to: 'user@example.com',
      from: 'service@biz.com',
      subject: 'Test HTML',
      html: '<p>Hello <b>world</b></p>',
    });

    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded).toContain('multipart/alternative');
    expect(decoded).toContain('text/plain');
    expect(decoded).toContain('text/html');
  });

  it('uses provided plain text instead of auto-generating', () => {
    const raw = buildRawEmail({
      to: 'user@example.com',
      from: 'service@biz.com',
      subject: 'Test',
      html: '<p>HTML version</p>',
      text: 'Custom plain text',
    });

    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded).toContain('multipart/alternative');
  });

  it('includes Reply-To header when provided', () => {
    const raw = buildRawEmail({
      to: 'user@example.com',
      from: 'service@biz.com',
      subject: 'Test',
      text: 'Hello',
      replyTo: 'reply@biz.com',
    });

    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded).toContain('Reply-To: reply@biz.com');
  });

  it('returns URL-safe base64', () => {
    const raw = buildRawEmail({
      to: 'user@example.com',
      from: 'service@biz.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(raw).not.toContain('+');
    expect(raw).not.toContain('/');
    expect(raw).not.toContain('=');
  });
});

describe('isBusinessHours', () => {
  it('returns a boolean', () => {
    const result = isBusinessHours('America/Chicago');
    expect(typeof result).toBe('boolean');
  });

  it('works with different timezones', () => {
    // Should not throw for valid timezones
    expect(() => isBusinessHours('America/New_York')).not.toThrow();
    expect(() => isBusinessHours('Europe/London')).not.toThrow();
    expect(() => isBusinessHours('Asia/Tokyo')).not.toThrow();
  });
});
