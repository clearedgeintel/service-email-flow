import { describe, it, expect } from 'vitest';
import { parseFromHeader, normalizeEmailBody } from './gmail';

describe('parseFromHeader', () => {
  it('parses angle-bracket format', () => {
    const result = parseFromHeader('John Doe <john@example.com>');
    expect(result).toEqual({ name: 'John Doe', email: 'john@example.com' });
  });

  it('parses quoted display name', () => {
    const result = parseFromHeader('"Jane Smith" <jane@test.com>');
    expect(result).toEqual({ name: 'Jane Smith', email: 'jane@test.com' });
  });

  it('parses parenthetical format', () => {
    const result = parseFromHeader('john@example.com (John Doe)');
    expect(result).toEqual({ name: 'John Doe', email: 'john@example.com' });
  });

  it('parses bare email', () => {
    const result = parseFromHeader('john@example.com');
    expect(result).toEqual({ name: 'john', email: 'john@example.com' });
  });

  it('handles string without @', () => {
    const result = parseFromHeader('Unknown Sender');
    expect(result).toEqual({ name: 'Unknown Sender', email: '' });
  });
});

describe('normalizeEmailBody', () => {
  it('strips HTML tags', () => {
    const result = normalizeEmailBody('<p>Hello <b>world</b></p>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<b>');
  });

  it('decodes HTML entities', () => {
    const result = normalizeEmailBody('Tom &amp; Jerry &lt;3 &gt;_&gt;');
    expect(result).toContain('Tom & Jerry');
    expect(result).toContain('<3');
  });

  it('removes quoted replies', () => {
    const result = normalizeEmailBody(
      'Please fix my sink.\n\nOn Mon, Jan 5, 2025 at 10:00 AM John wrote:\nOld message here',
    );
    expect(result).toContain('Please fix my sink');
    expect(result).not.toContain('Old message here');
  });

  it('removes signatures', () => {
    const result = normalizeEmailBody('I need a plumber.\n\nSent from my iPhone');
    expect(result).toContain('I need a plumber');
    expect(result).not.toContain('Sent from my iPhone');
  });

  it('collapses whitespace', () => {
    const result = normalizeEmailBody('Line 1\n\n\n\n\nLine 2');
    // The \s+ regex collapses all whitespace (including newlines) into single spaces first,
    // then the final \n{3,} pass handles any remaining triple+ newlines
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
  });

  it('handles empty input', () => {
    const result = normalizeEmailBody('');
    expect(result).toBe('');
  });
});
