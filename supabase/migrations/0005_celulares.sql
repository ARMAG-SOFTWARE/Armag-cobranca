-- Fase 2: estoque de celulares (Celulares), com custo de aquisição, venda e
-- lucro rastreados separadamente dos contratos de empréstimo/financiamento.
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada ou removida.
--
-- Um celular pode ser vendido de duas formas:
--   1) Vinculado a um contrato de "Venda de iPhone" (parcelado, com os 30% de
--      juros aplicados normalmente pelo fluxo já existente) — contract_id
--      aponta para o contrato e sale_amount = valor do produto acordado
--      (principal_amount do contrato, sem o markup), que é o preço real de
--      venda do aparelho para fins de lucro.
--   2) Venda direta, fora do sistema de parcelas (à vista, sem contrato) —
--      contract_id fica nulo, sale_amount/sale_method/sold_at são
--      preenchidos diretamente na tela de estoque.
-- Em ambos os casos, lucro = sale_amount - cost_amount (calculado sob
-- demanda, nunca persistido, para nunca divergir do valor de custo/venda).

create table if not exists phones (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  description text,
  cost_amount numeric(12, 2) not null check (cost_amount >= 0),
  status text not null default 'estoque' check (status in ('estoque', 'vendido')),
  acquired_at date not null default current_date,
  sale_amount numeric(12, 2) check (sale_amount is null or sale_amount >= 0),
  sale_method text check (sale_method is null or sale_method in ('dinheiro', 'pix', 'cartao', 'outro')),
  sold_at timestamptz,
  buyer_name text,
  contract_id uuid references contracts (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists phones_status_idx on phones (status);
create index if not exists phones_contract_id_idx on phones (contract_id);
create index if not exists phones_sold_at_idx on phones (sold_at);

create trigger phones_set_updated_at
  before update on phones
  for each row execute function set_updated_at();

alter table phones enable row level security;

create policy "Authenticated full access" on phones
  for all to authenticated using (true) with check (true);
