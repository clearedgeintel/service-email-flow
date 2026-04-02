import { describe, it, expect } from 'vitest';
import { sanitizeHtml, escapeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeHtml('<p>Hello</p><script>alert("xss")</script>');
    expect(result).toContain('<p>Hello</p>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
  });

  it('strips iframe tags', () => {
    const result = sanitizeHtml('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('strips object and embed tags', () => {
    const result = sanitizeHtml('<object data="x"></object><embed src="y">');
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
  });

  it('strips form tags', () => {
    const result = sanitizeHtml('<form action="/steal"><input></form>');
    expect(result).not.toContain('<form');
  });

  it('removes inline event handlers', () => {
    const result = sanitizeHtml('<div onclick="steal()">Click me</div>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('steal()');
  });

  it('blocks javascript: URLs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">Click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('blocked:');
  });

  it('preserves safe HTML', () => {
    const result = sanitizeHtml('<p>Hello <b>world</b></p>');
    expect(result).toBe('<p>Hello <b>world</b></p>');
  });

  it('strips link and meta tags', () => {
    const result = sanitizeHtml('<link rel="stylesheet" href="evil.css"><meta http-equiv="refresh">');
    expect(result).not.toContain('<link');
    expect(result).not.toContain('<meta');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe("it&#39;s");
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
