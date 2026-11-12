# Mercury Group of Contractors — Payroll System (V3)

Client: Mercury Group of Contractors, Ambattur, Chennai.

`index.html` is the client's app, **unchanged**. Hosted on Vercel as a static site.

## Files

| File | What it is |
|---|---|
| `index.html` | The app, exactly as supplied |
| `vercel.json` | Vercel static hosting settings |
| `supabase/schema.sql` | Supabase tables for users/roles (and data, for later use) |

## Vercel
Add New → Project → import this repo → Framework preset **Other**, no build command, output directory `.` → Deploy.

## Supabase users
Users are created in Supabase Auth as `<username>@payroll.local`, with roles in `public.profiles`.
See setup steps in the project notes. Note: the unchanged app still checks logins against its own built-in user list
(stored in each browser); Supabase users are used only once the app is connected to Supabase.

## Security rules
- This repo is public. Never commit backup JSON files, the `sb_secret_...` key, the database password or `.env` files.
