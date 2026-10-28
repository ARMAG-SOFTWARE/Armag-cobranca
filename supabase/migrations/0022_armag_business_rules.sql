-- ============================================================
-- Regras de negócio do Armag Cobrança
--
-- 1. Periodicidade "diaria" (vence todo dia, inclusive fim de semana e
--    feriado), além de semanal, quinzenal e mensal.
-- 2. Juros de atraso configurável: a taxa (% ao dia sobre o valor total do
--    contrato) fica em `business_settings` e é COPIADA para cada contrato
--    no cadastro — mudar a configuração não altera contratos existentes.
--    Contratos anteriores a esta migration ficam com 1%/dia, a regra fixa
--    que valia até aqui.
-- 3. `business_settings`: uma linha por usuário, com a taxa padrão de
--    atraso e como o botão de cobrança abre o WhatsApp (Business).
-- ============================================================

alter table contracts drop constraint if exists contracts_periodicity_check;
alter table contracts add constraint contracts_periodicity_check
  check (periodicity in ('diaria', 'semanal', 'quinzenal', 'mensal'));

alter table contracts add column if not exists late_interest_rate_percent_per_day numeric not null default 1;
alter table contracts drop constraint if exists contracts_late_interest_rate_check;
alter table contracts add constraint contracts_late_interest_rate_check
  check (late_interest_rate_percent_per_day >= 0 and late_interest_rate_percent_per_day <= 100);

alter table contracts drop constraint if exists contracts_interest_rate_check;
alter table contracts add constraint contracts_interest_rate_check
  check (interest_rate_percent >= 0 and interest_rate_percent <= 1000);

create table if not exists business_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  late_interest_rate_percent_per_day numeric not null default 1
    check (late_interest_rate_percent_per_day >= 0 and late_interest_rate_percent_per_day <= 100),
  whatsapp_open_mode text not null default 'padrao'
    check (whatsapp_open_mode in ('padrao', 'business_android', 'web')),
  business_whatsapp_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists business_settings_set_updated_at on business_settings;
create trigger business_settings_set_updated_at
  before update on business_settings
  for each row execute function set_updated_at();

alter table business_settings enable row level security;

drop policy if exists "Owner full access" on business_settings;
create policy "Owner full access" on business_settings
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
