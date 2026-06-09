import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/password';

/** GET — list users in the caller's tenant. */
export async function GET() {
  const ctx = await requireTenantContext();
  if (ctx instanceof NextResponse) return ctx;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, last_login_at, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().max(120).optional(),
  role: z.enum(['admin', 'super_admin']).optional(),
});

/** POST — create a new user in the caller's tenant. */
export async function POST(request: NextRequest) {
  const ctx = await requireTenantContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = CreateUserSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Only super_admin can mint another super_admin; everyone else creates regular admins
  const requestedRole = parsed.data.role || 'admin';
  if (requestedRole === 'super_admin' && ctx.userRole !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can create super_admin users' }, { status: 403 });
  }

  const supabase = getSupabase();
  const passwordHash = await hashPassword(parsed.data.password);

  const { data, error } = await supabase
    .from('users')
    .insert({
      tenant_id: ctx.tenantId,
      email: parsed.data.email.toLowerCase(),
      password_hash: passwordHash,
      name: parsed.data.name || null,
      role: requestedRole,
    })
    .select('id, email, name, role, created_at')
    .single();

  if (error) {
    // 23505 = unique violation (email already exists for this tenant)
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data }, { status: 201 });
}
