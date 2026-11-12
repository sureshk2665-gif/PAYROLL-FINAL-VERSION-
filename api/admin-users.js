// Vercel serverless function: admin-only user management.
// Needs these Environment Variables in Vercel (Project → Settings → Environment Variables):
//   SUPABASE_URL         https://<project>.supabase.co
//   SUPABASE_SECRET_KEY  sb_secret_...   (never put this in the browser or in git)
//   LOGIN_DOMAIN         payroll.local   (must match loginDomain in config.js)
const { createClient } = require('@supabase/supabase-js');

const ROLES = ['vendor', 'admin', 'supervisor', 'operator'];
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  const domain = process.env.LOGIN_DOMAIN || 'payroll.local';
  if (!url || !secret) return res.status(500).json({ error: 'Server is missing SUPABASE_URL / SUPABASE_SECRET_KEY settings.' });

  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is calling? Must be an active admin or software admin.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  const { data: who, error: whoErr } = await sb.auth.getUser(token);
  if (whoErr || !who || !who.user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  const { data: caller } = await sb.from('profiles').select('id, role, active').eq('id', who.user.id).maybeSingle();
  if (!caller || !caller.active || !['vendor', 'admin'].includes(caller.role)) {
    return res.status(403).json({ error: 'Only an admin can manage users.' });
  }

  const body = req.body || {};
  try {
    if (body.action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      const fullName = String(body.full_name || '').trim();
      const role = String(body.role || 'operator');
      const password = String(body.password || '');
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username: 3-30 characters, letters, numbers, dot, dash or underscore.' });
      if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
      if (role === 'vendor' && caller.role !== 'vendor') return res.status(403).json({ error: 'Only the software admin can create a software admin.' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

      const { data: created, error } = await sb.auth.admin.createUser({
        email: `${username}@${domain}`,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: fullName }
      });
      if (error) {
        const dup = /already|registered|exists/i.test(error.message);
        return res.status(dup ? 409 : 400).json({ error: dup ? 'Username already exists.' : error.message });
      }
      const { error: pErr } = await sb.from('profiles')
        .update({ username, full_name: fullName, role, active: true })
        .eq('id', created.user.id);
      if (pErr) return res.status(500).json({ error: 'User created but profile update failed: ' + pErr.message });
      return res.status(200).json({ ok: true, id: created.user.id });
    }

    if (body.action === 'set_password') {
      const id = String(body.id || '');
      const password = String(body.password || '');
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      const { data: target } = await sb.from('profiles').select('id, role').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.role === 'vendor' && caller.role !== 'vendor') return res.status(403).json({ error: 'Only the software admin can change this password.' });
      const { error } = await sb.auth.admin.updateUserById(id, { password });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
