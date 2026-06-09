import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/password';

const PatchSchema = z.object({
  name: z.string().max(120).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['admin', 'super_admin']).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

/** PATCH — update a user in the caller's tenant. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContext();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Promoting to super_admin requires super_admin
  if (parsed.data.role === 'super_admin' && ctx.userRole !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can grant super_admin' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.password !== undefined) {
    updates.password_hash = await hashPassword(parsed.data.password);
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)  // prevent cross-tenant patches
    .select('id, email, name, role, last_login_at, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user: data });
}

/** DELETE — remove a user from the caller's tenant. Can't remove yourself. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContext();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (id === ctx.userId) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
