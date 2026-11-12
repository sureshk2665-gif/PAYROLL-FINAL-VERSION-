# Mercury Group of Contractors — Payroll System (V3)

Client: Mercury Group of Contractors, Ambattur, Chennai.

Payroll web app: contractors, employees, attendance, advances, payroll, reports and user roles.
Runs on **Vercel** with data and logins in **Supabase**.

## Files

| File | What it is |
|---|---|
| `index.html` | The app (UI + payroll logic) |
| `config.js` | Supabase URL + publishable key (public by design) and login domain |
| `cloud.js` | Supabase layer: login, loading/saving data, user management calls |
| `api/admin-users.js` | Vercel function: create users / reset passwords (uses the secret key on the server) |
| `supabase/schema.sql` | Database tables, security rules (RLS) and change history |
| `package.json` | Dependency for the Vercel function |

## How data is stored

- `app_data`: one row per dataset — `settings`, `contractors`, `employees` (attendance inside), `advances`, `payroll_history`.
- `app_data_history`: every save keeps the previous version (admins can recover it in Supabase).
- `profiles`: each login's username, name, role (Software Admin / Admin / Supervisor / Operator) and active flag.
- If two users edit the same dataset at once, the second save is stopped and that user is asked to reload — nobody's work is silently overwritten.

## One-time setup

### 1. Supabase
1. SQL Editor → New query → paste all of `supabase/schema.sql` → **Run**.
2. Authentication → Users → **Add user** → **Create new user**:
   email `softadmin@payroll.local`, a strong password, tick **Auto Confirm User**.
3. SQL Editor → run:
   ```sql
   update public.profiles set role = 'vendor', full_name = 'Software Admin', active = true where username = 'softadmin';
   ```
4. Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up" (only admins create users).

### 2. Vercel
1. Add New → Project → import this GitHub repo. Framework preset **Other**, no build command, output directory `.`.
2. Settings → Environment Variables:
   - `SUPABASE_URL` = `https://bntryiqpgvsiydukbkdn.supabase.co`
   - `SUPABASE_SECRET_KEY` = the `sb_secret_...` key from Supabase → Project Settings → API Keys
   - `LOGIN_DOMAIN` = `payroll.local`
3. Deploy. Every push to the production branch redeploys automatically.

### 3. First login
1. Open the Vercel URL, log in as `softadmin`.
2. Admin (Backup & Rights) → **Restore Data from Backup File** → choose the client's backup JSON.
3. Admin → Login Users → **Add User** for the client's admin, supervisor and operators.

## Security rules

- Never commit: backup JSON files, the `sb_secret_...` key, the database password, `.env` files. This repo is public.
- The publishable key in `config.js` is safe to be public; RLS in `schema.sql` blocks anyone who is not a logged-in, active user.
- Usernames are stored in Supabase Auth as `<username>@payroll.local` (no emails are sent).
