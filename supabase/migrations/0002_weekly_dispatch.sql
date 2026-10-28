-- Agendamento e disparo de cobranças semanais via WhatsApp (Evolution API)
-- Tabela aditiva: não altera clients/contracts/installments existentes.

-- ============================================================
-- weekly_charges
-- Um registro por contrato de periodicidade 'semanal', controlando
-- quando o próximo disparo automático de cobrança deve ocorrer.
--
-- status:
--   PENDENTE  -> segue sendo disparado semanalmente
--   PAGO      -> contrato quitado (sincronizado automaticamente), disparo abortado
--   CANCELADO -> contrato cancelado (sincronizado automaticamente), disparo abortado
--
-- O pagamento continua sendo controlado manualmente pelos toggles de
-- parcela já existentes em installments (pendente/pago/atrasado) — este
-- status apenas reflete, em tempo real, se o disparo semanal deve
-- continuar ou ser abortado.
-- ============================================================
create table if not exists weekly_charges (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'PAGO', 'CANCELADO')),
  dia_semana_disparo smallint not null check (dia_semana_disparo between 1 and 5), -- ISO 8601: 1=segunda ... 5=sexta
  proximo_disparo date not null,
  last_dispatch_at timestamptz,
  dispatch_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id)
);

create index if not exists weekly_charges_due_idx
  on weekly_charges (status, dia_semana_disparo, proximo_disparo);
create index if not exists weekly_charges_client_id_idx on weekly_charges (client_id);

create trigger weekly_charges_set_updated_at
  before update on weekly_charges
  for each row execute function set_updated_at();

alter table weekly_charges enable row level security;

create policy "Authenticated full access" on weekly_charges
  for all to authenticated using (true) with check (true);
