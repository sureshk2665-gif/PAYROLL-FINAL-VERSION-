// cloud.js — Supabase data + login layer for the payroll app.
// Replaces the old browser localStorage: data is loaded once after login,
// kept in memory, and every save is written to Supabase in the background.
(function () {
  const cfg = window.PAYROLL_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, storageKey: 'mercury_payroll_auth' }
  });

  // Old localStorage key -> row key in public.app_data
  const KEY_MAP = {
    mercury_contractors_employees_v3: 'employees',
    mercury_contractors_list_v3: 'contractors',
    mercury_contractors_advances_v3: 'advances',
    mercury_contractors_settings_v3: 'settings',
    mercury_payroll_history_v3: 'payroll_history'
  };
  const LABEL = { employees: 'Employees & Attendance', contractors: 'Contractors', advances: 'Advances', settings: 'Settings', payroll_history: 'Payroll History' };

  const cache = {};     // dataset -> parsed JSON value
  const stamp = {};     // dataset -> updated_at of the version we hold (null = row not created yet)
  const version = {};   // dataset -> local change counter
  const saved = {};     // dataset -> last counter written to the server
  const timers = {};
  const chains = {};
  let blocked = false;  // true after a conflict: stop writing so nobody's work is overwritten

  function key(k) {
    const c = KEY_MAP[k];
    if (!c) throw new Error('Unknown storage key: ' + k);
    return c;
  }

  // ---------- save status indicator ----------
  function setStatus(state, text) {
    const el = document.getElementById('cloudStatus');
    if (!el) return;
    const look = {
      saved:  ['text-emerald-600', 'fa-cloud', 'All changes saved'],
      saving: ['text-amber-500', 'fa-cloud-arrow-up', 'Saving…'],
      error:  ['text-rose-600', 'fa-triangle-exclamation', 'Not saved — retrying']
    }[state];
    el.className = 'text-[10px] font-semibold flex items-center gap-1 ' + look[0];
    el.innerHTML = `<i class="fa-solid ${look[1]}"></i><span>${text || look[2]}</span>`;
  }
  function hasPending() { return Object.keys(version).some(c => version[c] !== saved[c]); }
  function refreshStatus() { if (!blocked) setStatus(hasPending() ? 'saving' : 'saved'); }

  function showConflict(c) {
    blocked = true;
    setStatus('error', 'Saving stopped');
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[200] bg-slate-900/70 flex items-center justify-center p-4';
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
      <div class="bg-rose-600 text-white px-5 py-3 font-bold"><i class="fa-solid fa-users mr-2"></i>Someone else saved changes</div>
      <div class="p-5 space-y-3 text-sm text-slate-700">
        <p>Another user saved <b>${LABEL[c] || c}</b> while you were working. To avoid overwriting their work, your latest change was <b>not saved</b>.</p>
        <p>Reload to get the latest data, then make your change again.</p>
        <div class="flex justify-end pt-2"><button class="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600" onclick="location.reload()">Reload now</button></div>
      </div></div>`;
    document.body.appendChild(box);
  }

  async function save(c) {
    if (blocked) return;
    const v = version[c];
    if (v === saved[c]) return;
    const value = cache[c];
    let res;
    if (stamp[c] == null) {
      res = await sb.from('app_data').insert({ key: c, value }).select('updated_at');
      if (res.error && res.error.code === '23505') return showConflict(c);   // someone created it first
    } else {
      res = await sb.from('app_data').update({ value }).eq('key', c).eq('updated_at', stamp[c]).select('updated_at');
      if (!res.error && (!res.data || res.data.length === 0)) return showConflict(c);   // row changed since we loaded it
    }
    if (res.error) throw res.error;
    stamp[c] = res.data[0].updated_at;
    saved[c] = v;
  }

  function flush(c) {
    chains[c] = (chains[c] || Promise.resolve()).then(() => save(c)).then(refreshStatus).catch(err => {
      console.error('Save failed', c, err);
      setStatus('error');
      if (window.showToast) window.showToast('Could not save ' + (LABEL[c] || c) + ': ' + (err.message || err) + '. Retrying…', 'danger');
      clearTimeout(timers[c]);
      timers[c] = setTimeout(() => flush(c), 5000);
    });
    return chains[c];
  }

  // Drop-in replacement for localStorage, for the payroll data keys only.
  const store = {
    getItem(k) { const c = key(k); return cache[c] === undefined ? null : JSON.stringify(cache[c]); },
    setItem(k, v) {
      const c = key(k);
      cache[c] = JSON.parse(v);
      version[c] = (version[c] || 0) + 1;
      if (blocked) return;
      setStatus('saving');
      clearTimeout(timers[c]);
      timers[c] = setTimeout(() => flush(c), 400);
    }
  };

  window.addEventListener('beforeunload', e => {
    if (hasPending() && !blocked) { e.preventDefault(); e.returnValue = ''; }
  });

  function errMsg(error) {
    if (!error) return 'Unknown error';
    if (error.code === 'invalid_credentials' || /Invalid login credentials/i.test(error.message)) return 'Invalid username or password';
    return error.message || String(error);
  }

  async function myProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb.from('profiles').select('id, username, full_name, role, active').eq('id', user.id).maybeSingle();
    if (error) throw new Error(errMsg(error));
    return data;
  }

  window.store = store;
  window.Cloud = {
    hasPending,
    toEmail(login) { login = login.trim().toLowerCase(); return login.includes('@') ? login : `${login}@${cfg.loginDomain}`; },

    async signIn(login, password) {
      const { error } = await sb.auth.signInWithPassword({ email: this.toEmail(login), password });
      if (error) throw new Error(errMsg(error));
      return myProfile();
    },
    async currentProfile() {
      const { data: { session } } = await sb.auth.getSession();
      return session ? myProfile() : null;
    },
    async signOut() { await sb.auth.signOut(); },

    async loadAll() {
      const { data, error } = await sb.from('app_data').select('key, value, updated_at');
      if (error) throw new Error('Could not load data: ' + errMsg(error));
      Object.values(KEY_MAP).forEach(c => { delete cache[c]; stamp[c] = null; version[c] = saved[c] = 0; });
      data.forEach(r => { cache[r.key] = r.value; stamp[r.key] = r.updated_at; });
      setStatus('saved');
    },
    async flushAll() { await Promise.all(Object.keys(version).map(c => { clearTimeout(timers[c]); return flush(c); })); },
    async resetAll() {
      const { error } = await sb.from('app_data').delete().in('key', Object.values(KEY_MAP));
      if (error) throw new Error(errMsg(error));
    },
    async branding() {
      const { data, error } = await sb.rpc('public_branding');
      if (error) throw error;
      return data || {};
    },

    // ----- users -----
    async listProfiles() {
      const { data, error } = await sb.from('profiles').select('id, username, full_name, role, active').order('username');
      if (error) throw new Error(errMsg(error));
      return data;
    },
    async updateProfile(id, patch) {
      const { data, error } = await sb.from('profiles').update(patch).eq('id', id).select('id');
      if (error) throw new Error(errMsg(error));
      if (!data || !data.length) throw new Error('You do not have permission to change this user.');
    },
    async changeOwnPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(errMsg(error));
    },
    // Creating users / resetting other users' passwords needs the secret key,
    // so it runs on the server (Vercel function api/admin-users.js).
    async adminUsers(action, body) {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error('Please log in again.');
      let r;
      try {
        r = await fetch('/api/admin-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
          body: JSON.stringify({ action, ...body })
        });
      } catch (e) { throw new Error('User service is not reachable. It works only on the deployed (Vercel) site.'); }
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || ('User service error ' + r.status + (r.status === 404 ? ' — it works only on the deployed (Vercel) site.' : '')));
      return out;
    }
  };
})();
