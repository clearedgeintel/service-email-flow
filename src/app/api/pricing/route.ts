import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pricing_items')
    .select('*')
    .order('trade')
    .order('service');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const { trade, service, keywords, price_min, price_max, unit } = body;

  if (!trade || !service || !keywords || !price_min || !price_max) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pricing_items')
    .insert({
      trade,
      service,
      keywords: Array.isArray(keywords) ? keywords : keywords.split(',').map((k: string) => k.trim()),
      price_min,
      price_max,
      unit: unit || 'per job',
      active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data }, { status: 201 });
}
