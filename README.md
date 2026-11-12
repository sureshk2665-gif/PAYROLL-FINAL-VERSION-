# Mercury Group of Contractors — Payroll System (V3)

Client: Mercury Group of Contractors, Ambattur, Chennai.

Single-page payroll app (`index.html`): contractors, employees, attendance, advances, payroll, reports, user roles.

## Current state
- Pure static HTML + Tailwind CDN; no build step.
- Data is stored in the browser's `localStorage` (keys `mercury_contractors_*_v3`, users in `mercury_payroll_users_v1`).
- Backup / Restore is a JSON export from the Admin panel.

## Deploy plan
1. **Vercel** — import this repo as a static project (framework: Other, no build command, output dir `.`). `index.html` is served at `/`.
2. **Supabase** — move `localStorage` data (settings, contractors, employees, advances, users) into Supabase tables and replace login with Supabase Auth.

## Security notes
- Default logins are hard-coded in `index.html` (`softadmin`, `admin`, `supervisor`, `operator`) and passwords are checked in the browser. Change them after first login; this must be replaced by Supabase Auth before real use.
- Client backup files (`*_backup_*.json`) are git-ignored — this repo is public. Do not commit real payroll data.
