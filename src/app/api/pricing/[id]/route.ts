import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { trade, service, keywords, price_min, price_max, unit, active } = body;

  const updates: Record<string, unknown> = {};
  if (trade !== undefined) updates.trade = trade;
  if (service !== undefined) updates.service = service;
  if (keywords !== undefined) {
    updates.keywords = Array.isArray(keywords) ? keywords : keywords.split(',').map((k: string) => k.trim());
  }
  if (price_min !== undefined) updates.price_min = price_min;
  if (price_max !== undefined) updates.price_max = price_max;
  if (unit !== undefined) updates.unit = unit;
  if (active !== undefined) updates.active = active;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pricing_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { id } = await params;
  const supabase = getSupabase();

  // Soft delete
  const { error } = await supabase
    .from('pricing_items')
    .update({ active: false })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
