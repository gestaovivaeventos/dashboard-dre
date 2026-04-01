-- AI Reports: stores all generated reports (drafts, sent, errors)
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  company_ids uuid[] not null,
  period_from date not null,
  period_to date not null,
  content_html text not null,
  content_json jsonb not null,
  recipients text[] not null default '{}',
  sent_at timestamptz,
  status text not null default 'draft',
  error_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ai_reports_type_idx on public.ai_reports(type);
create index ai_reports_status_idx on public.ai_reports(status);
create index ai_reports_created_at_idx on public.ai_reports(created_at desc);

alter table public.ai_reports enable row level security;

create policy "Admins can manage reports"
  on public.ai_reports for all to authenticated
  using (public.is_admin());

-- Company Contacts: email recipients per company
create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text not null,
  role_label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index company_contacts_company_idx on public.company_contacts(company_id);

alter table public.company_contacts enable row level security;

create policy "Admins can manage contacts"
  on public.company_contacts for all to authenticated
  using (public.is_admin());
