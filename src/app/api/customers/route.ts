import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCustomerProfile, getRepeatCustomers } from '@/services/smart.service';

/** GET /api/customers?email=... — Get customer profile, or list repeat customers */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const email = request.nextUrl.searchParams.get('email');

  if (email) {
    const profile = await getCustomerProfile(email);
    if (!profile) {
      return NextResponse.json({ error: 'No cases found for this email' }, { status: 404 });
    }
    return NextResponse.json({ customer: profile });
  }

  // List repeat customers
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');
  const customers = await getRepeatCustomers(Math.min(limit, 100));

  return NextResponse.json({
    customers,
    total: customers.length,
  });
}
