import { vi } from 'vitest';

/**
 * Creates a mock Supabase client with chainable query builder.
 * Override `data`, `error`, or `count` to control what queries return.
 */
export function createMockSupabase(overrides?: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}) {
  const data = overrides?.data ?? null;
  const error = overrides?.error ?? null;
  const count = overrides?.count ?? null;

  const terminalResult = { data, error, count };

  const chainable: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };

  // Make select/insert/update/delete also act as terminal (for queries without .single())
  // When awaited directly, they resolve with { data, error, count }
  const makeThenable = (fn: ReturnType<typeof vi.fn>) => {
    fn.mockImplementation((...args: unknown[]) => {
      const result = {
        ...chainable,
        then: (resolve: (val: unknown) => void) => resolve(terminalResult),
      };
      return result;
    });
  };

  // Override select to be both chainable and thenable
  chainable.select.mockImplementation(() => {
    return new Proxy(chainable, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve: (val: unknown) => void) => resolve(terminalResult);
        }
        return target[prop as string];
      },
    });
  });

  // Insert/update/delete return chainable that resolves
  for (const method of ['insert', 'update', 'delete', 'upsert']) {
    chainable[method].mockImplementation(() => {
      return new Proxy(chainable, {
        get(target, prop) {
          if (prop === 'then') {
            return (resolve: (val: unknown) => void) => resolve(terminalResult);
          }
          return target[prop as string];
        },
      });
    });
  }

  const mock = {
    from: vi.fn().mockReturnValue(chainable),
    rpc: vi.fn().mockResolvedValue({ data, error }),
    _chain: chainable,
    _setResult(newData: unknown, newError?: { message: string } | null) {
      chainable.single.mockResolvedValue({ data: newData, error: newError ?? null });
      chainable.maybeSingle.mockResolvedValue({ data: newData, error: newError ?? null });
    },
  };

  return mock;
}

/** Creates a mock Anthropic client */
export function createMockAnthropic(responseContent: string = '{}') {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseContent }],
      }),
    },
  };
}

/** Creates a mock Gmail client */
export function createMockGmail() {
  return {
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: vi.fn().mockResolvedValue({ data: {} }),
        send: vi.fn().mockResolvedValue({ data: { id: 'sent-msg-id' } }),
        modify: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
}
