// Public Supabase settings for the browser.
// The publishable key is meant to be public: Row Level Security in supabase/schema.sql protects the data.
// NEVER put the secret (sb_secret_...) key or the database password here.
window.PAYROLL_CONFIG = {
  supabaseUrl: 'https://bntryiqpgvsiydukbkdn.supabase.co',
  supabaseKey: 'sb_publishable_4OoS9DyDVZRe61HRq9gE8g_BqOLujrp',
  // Users log in with a username; Supabase Auth stores it as <username>@<loginDomain>.
  // Must match LOGIN_DOMAIN in the Vercel environment (api/admin-users.js).
  loginDomain: 'payroll.local'
};
