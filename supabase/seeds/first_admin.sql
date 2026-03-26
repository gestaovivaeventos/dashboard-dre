-- Create/Promote first admin user after first auth signup.
-- Replace the email below and run in Supabase SQL editor.

insert into public.users (id, email, name, role, active)
select
  au.id,
  au.email,
  coalesce(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
  'admin'::public.user_role,
  true
from auth.users au
where au.email = 'SEU_EMAIL_ADMIN@EMPRESA.COM'
on conflict (id) do update
set
  role = 'admin',
  active = true,
  email = excluded.email;
