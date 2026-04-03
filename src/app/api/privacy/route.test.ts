import { describe, it, expect, vi } from 'vitest';
import { createRequest, parseResponse } from '@/test/api-helpers';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/retention.service', () => ({
  exportCustomerData: vi.fn().mockResolvedValue({ cases: [{ id: 1 }], events: [{ id: 10 }] }),
  forgetCustomer: vi.fn().mockResolvedValue({ casesAnonymized: 1, eventsDeleted: 2 }),
}));

import { GET, DELETE } from './route';
import { requireAuth } from '@/lib/auth';

const mockedRequireAuth = vi.mocked(requireAuth);

describe('GET /api/privacy', () => {
  it('exports customer data for valid email', async () => {
    const req = createRequest('/api/privacy', {
      searchParams: { email: 'test@example.com' },
    });

    const res = await GET(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.email).toBe('test@example.com');
    expect(body.cases).toHaveLength(1);
    expect(body.events).toHaveLength(1);
  });

  it('returns 400 for invalid email', async () => {
    const req = createRequest('/api/privacy', {
      searchParams: { email: 'not-an-email' },
    });

    const res = await GET(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockedRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const req = createRequest('/api/privacy', {
      searchParams: { email: 'test@example.com' },
    });
    const res = await GET(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(401);
  });
});

describe('DELETE /api/privacy', () => {
  it('forgets customer data for valid email', async () => {
    const req = createRequest('/api/privacy', {
      method: 'DELETE',
      body: { email: 'test@example.com' },
    });

    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.casesAnonymized).toBe(1);
    expect(body.eventsDeleted).toBe(2);
  });

  it('returns 400 for invalid email', async () => {
    const req = createRequest('/api/privacy', {
      method: 'DELETE',
      body: { email: '' },
    });

    const res = await DELETE(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(400);
  });
});
