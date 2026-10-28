-- Fase 1 do núcleo financeiro: markup de 30%, entrada opcional na venda de
-- iPhone, juros de atraso, pagamentos (com forma de pagamento e suporte a
-- pagamento parcial) e controle de saídas/despesas.
--
-- Migration aditiva: nenhuma coluna/tabela existente é removida ou tem seu
-- tipo alterado. Contratos e parcelas já existentes continuam com os mesmos
-- valores (total_amount não é recalculado para linhas antigas).

-- ============================================================
-- contracts: markup e entrada
-- ============================================================
alter table contracts
  add column if not exists principal_amount numeric(12, 2),
  add column if not exists has_down_payment boolean not null default false,
  add column if not exists down_payment_amount numeric(12, 2) not null default 0;

-- Backfill: para contratos já existentes, o valor que já estava em
-- total_amount nunca teve markup aplicado — ele se torna o "principal"
-- histórico. total_amount permanece intocado (preserva as parcelas já geradas).
update contracts
  set principal_amount = total_amount
  where principal_amount is null;

alter table contracts
  alter column principal_amount set not null,
  add constraint contracts_principal_amount_check check (principal_amount > 0),
  add constraint contracts_down_payment_amount_check check (down_payment_amount >= 0),
  add constraint contracts_down_payment_type_check
    check (not has_down_payment or type = 'venda_iphone');

-- ============================================================
-- installments: suporte a pagamento parcial
-- ============================================================
alter table installments
  add column if not exists paid_principal_amount numeric(12, 2) not null default 0;

alter table installments
  drop constraint if exists installments_status_check;

alter table installments
  add constraint installments_status_check
    check (status in ('pendente', 'pago', 'parcial', 'atrasado'));

alter table installments
  add constraint installments_paid_principal_amount_check
    check (paid_principal_amount >= 0);

-- ============================================================
-- payments: histórico de pagamentos (forma de pagamento + parcial + juros)
-- ============================================================
-- installment_id é opcional: null representa a entrada (down payment) de um
-- contrato de venda de iPhone, recebida à vista antes de existir qualquer
-- parcela. Toda linha sempre tem contract_id como âncora.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid references installments (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  principal_amount numeric(12, 2) not null check (principal_amount >= 0),
  interest_amount numeric(12, 2) not null default 0 check (interest_amount >= 0),
  method text not null check (method in ('dinheiro', 'pix', 'cartao', 'outro')),
  paid_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  constraint payments_down_payment_no_interest
    check (installment_id is not null or interest_amount = 0)
);

create index if not exists payments_installment_id_idx on payments (installment_id);
create index if not exists payments_contract_id_idx on payments (contract_id);
create index if not exists payments_paid_at_idx on payments (paid_at);
create index if not exists payments_method_idx on payments (method);

alter table payments enable row level security;

create policy "Authenticated full access" on payments
  for all to authenticated using (true) with check (true);

-- ============================================================
-- expenses: saídas manuais (combustível, celular, manutenção, etc.)
-- ============================================================
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('dinheiro', 'pix', 'cartao', 'outro')),
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_expense_date_idx on expenses (expense_date);
create index if not exists expenses_method_idx on expenses (method);

create trigger expenses_set_updated_at
  before update on expenses
  for each row execute function set_updated_at();

alter table expenses enable row level security;

create policy "Authenticated full access" on expenses
  for all to authenticated using (true) with check (true);
