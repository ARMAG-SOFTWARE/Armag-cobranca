-- Cobrança iPad MVP — schema inicial
-- Entidades: clients, contracts, installments, message_settings, message_logs

create extension if not exists "pgcrypto";

-- ============================================================
-- Função utilitária: mantém updated_at sincronizado
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- clients
-- ============================================================
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_name_idx on clients using gin (to_tsvector('simple', name));
create index if not exists clients_phone_idx on clients (phone);

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- ============================================================
-- contracts (empréstimo ou venda de iPhone parcelada)
-- ============================================================
create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  type text not null check (type in ('emprestimo', 'venda_iphone')),
  description text,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  installments_count integer not null check (installments_count > 0),
  periodicity text not null check (periodicity in ('semanal', 'quinzenal', 'mensal')),
  first_due_date date not null,
  status text not null default 'ativo' check (status in ('ativo', 'inadimplente', 'quitado', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracts_client_id_idx on contracts (client_id);
create index if not exists contracts_status_idx on contracts (status);

create trigger contracts_set_updated_at
  before update on contracts
  for each row execute function set_updated_at();

-- ============================================================
-- installments (parcelas de cada contrato)
-- ============================================================
create table if not exists installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id) on delete cascade,
  number integer not null,
  amount numeric(12, 2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),
  paid_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, number)
);

create index if not exists installments_contract_id_idx on installments (contract_id);
create index if not exists installments_due_date_idx on installments (due_date);
create index if not exists installments_status_idx on installments (status);

create trigger installments_set_updated_at
  before update on installments
  for each row execute function set_updated_at();

-- ============================================================
-- message_settings (configuração da API de WhatsApp)
-- ============================================================
create table if not exists message_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('evolution', 'zapi', 'twilio', 'wppconnect')),
  base_url text,
  api_key text,
  instance_id text,
  sender_number text,
  auth_token text,
  message_template text not null default
    'Olá {nome_cliente}, identificamos que a sua parcela {numero_parcela} no valor de R$ {valor} com vencimento em {data_vencimento} consta pendente. Por favor, entre em contato para regularizar.',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger message_settings_set_updated_at
  before update on message_settings
  for each row execute function set_updated_at();

-- Garante no máximo uma configuração ativa por vez
create unique index if not exists message_settings_single_active_idx
  on message_settings ((is_active))
  where is_active;

-- ============================================================
-- message_logs (auditoria de envios de cobrança)
-- ============================================================
create table if not exists message_logs (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references installments (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  status text not null check (status in ('sent', 'failed')),
  provider_response jsonb,
  sent_at timestamptz not null default now()
);

create index if not exists message_logs_installment_id_idx on message_logs (installment_id);

-- ============================================================
-- Row Level Security
-- MVP de uso interno (single-tenant): libera acesso total para
-- usuários autenticados. Ajuste as policies antes de ir a produção
-- multiusuário.
-- ============================================================
alter table clients enable row level security;
alter table contracts enable row level security;
alter table installments enable row level security;
alter table message_settings enable row level security;
alter table message_logs enable row level security;

create policy "Authenticated full access" on clients
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on contracts
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on installments
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on message_settings
  for all to authenticated using (true) with check (true);

create policy "Authenticated full access" on message_logs
  for all to authenticated using (true) with check (true);
