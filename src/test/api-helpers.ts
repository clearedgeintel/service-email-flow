import { NextRequest } from 'next/server';

/**
 * Create a NextRequest for testing API routes.
 */
export function createRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    searchParams?: Record<string, string>;
  },
): NextRequest {
  const fullUrl = new URL(url, 'http://localhost:3000');
  if (options?.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      fullUrl.searchParams.set(key, value);
    }
  }

  const init: RequestInit = {
    method: options?.method || 'GET',
  };

  if (options?.body) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  const request = new NextRequest(fullUrl, init);

  // Set cookies if provided
  if (options?.cookies) {
    for (const [name, value] of Object.entries(options.cookies)) {
      request.cookies.set(name, value);
    }
  }

  return request;
}

/**
 * Parse a NextResponse to get status and JSON body.
 */
export async function parseResponse(response: Response): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const body = await response.json();
  return { status: response.status, body };
}
