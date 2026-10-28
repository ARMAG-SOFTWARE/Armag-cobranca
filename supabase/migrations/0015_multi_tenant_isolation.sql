-- Isolamento multiusuário (multi-tenant): cada usuário autenticado passa a
-- ver e mexer só nos próprios dados (clientes, empréstimos, parcelas,
-- pagamentos, despesas, vendas de iPhone, configuração de WhatsApp e
-- disparo semanal) — nunca os de outro usuário, mesmo entre si.
--
-- `audit_logs`, `message_logs` e `backup_runs` ficam de fora de propósito:
-- são logs internos/operacionais, nunca exibidos em nenhuma tela do app
-- (só gravados), então não há risco de um usuário ver o dado de outro por
-- aqui — manter como estavam evita uma migração mais arriscada sem
-- necessidade real.
--
-- Esta migração é ADITIVA e faz backfill dos dados já existentes: tudo que
-- já está cadastrado hoje passa a pertencer ao usuário mais antigo da conta
-- (o único existente até agora). Rode esta migração ANTES de publicar o
-- código que já espera `owner_id` — caso contrário o usuário atual perde
-- acesso aos próprios dados até a migração rodar.

-- ============================================================
-- 1. Coluna owner_id (ainda nullable, para permitir o backfill abaixo)
-- ============================================================
alter table clients add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table contracts add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table installments add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table payments add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table expenses add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table phones add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table message_settings add column if not exists owner_id uuid references auth.users (id) on delete cascade;
alter table weekly_charges add column if not exists owner_id uuid references auth.users (id) on delete cascade;

-- ============================================================
-- 2. Backfill — tudo que já existe pertence ao usuário mais antigo da conta
--    (hoje, o único). Propaga por relacionamento onde existe (cliente →
--    contrato → parcela/pagamento/venda), com o usuário mais antigo como
--    último recurso para o que não tem relacionamento (despesas) ou ficou
--    órfão (venda de iPhone sem contrato vinculado).
-- ============================================================
do $$
declare
  admin_id uuid;
begin
  select id into admin_id from auth.users order by created_at asc limit 1;

  -- Banco novo (nenhum registro antigo sem dono): não há o que atribuir,
  -- então a migration segue mesmo sem usuário criado ainda.
  if admin_id is null
    and not exists (select 1 from clients where owner_id is null)
    and not exists (select 1 from contracts where owner_id is null)
    and not exists (select 1 from installments where owner_id is null)
    and not exists (select 1 from payments where owner_id is null)
    and not exists (select 1 from expenses where owner_id is null)
    and not exists (select 1 from phones where owner_id is null)
    and not exists (select 1 from message_settings where owner_id is null)
    and not exists (select 1 from weekly_charges where owner_id is null)
  then
    return;
  end if;

  if admin_id is null then
    raise exception 'Nenhum usuário encontrado em auth.users — crie o usuário administrador antes de rodar esta migração.';
  end if;

  update clients set owner_id = admin_id where owner_id is null;

  update contracts c set owner_id = cl.owner_id
    from clients cl where cl.id = c.client_id and c.owner_id is null;
  update contracts set owner_id = admin_id where owner_id is null;

  update installments i set owner_id = c.owner_id
    from contracts c where c.id = i.contract_id and i.owner_id is null;
  update installments set owner_id = admin_id where owner_id is null;

  update payments p set owner_id = c.owner_id
    from contracts c where c.id = p.contract_id and p.owner_id is null;
  update payments set owner_id = admin_id where owner_id is null;

  update expenses set owner_id = admin_id where owner_id is null;

  update phones ph set owner_id = c.owner_id
    from contracts c where c.id = ph.contract_id and ph.owner_id is null;
  update phones set owner_id = admin_id where owner_id is null;

  update message_settings set owner_id = admin_id where owner_id is null;

  update weekly_charges wc set owner_id = cl.owner_id
    from clients cl where cl.id = wc.client_id and wc.owner_id is null;
  update weekly_charges set owner_id = admin_id where owner_id is null;
end $$;

-- ============================================================
-- 3. Trava owner_id como obrigatório, agora que todo registro tem um dono
-- ============================================================
alter table clients alter column owner_id set not null;
alter table contracts alter column owner_id set not null;
alter table installments alter column owner_id set not null;
alter table payments alter column owner_id set not null;
alter table expenses alter column owner_id set not null;
alter table phones alter column owner_id set not null;
alter table message_settings alter column owner_id set not null;
alter table weekly_charges alter column owner_id set not null;

create index if not exists clients_owner_id_idx on clients (owner_id);
create index if not exists contracts_owner_id_idx on contracts (owner_id);
create index if not exists installments_owner_id_idx on installments (owner_id);
create index if not exists payments_owner_id_idx on payments (owner_id);
create index if not exists expenses_owner_id_idx on expenses (owner_id);
create index if not exists phones_owner_id_idx on phones (owner_id);
create index if not exists message_settings_owner_id_idx on message_settings (owner_id);
create index if not exists weekly_charges_owner_id_idx on weekly_charges (owner_id);

-- ============================================================
-- 4. Troca a política "Authenticated full access" (qualquer autenticado
--    acessa tudo) por uma restrita ao dono de cada registro.
-- ============================================================
drop policy if exists "Authenticated full access" on clients;
create policy "Owner full access" on clients
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on contracts;
create policy "Owner full access" on contracts
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on installments;
create policy "Owner full access" on installments
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on payments;
create policy "Owner full access" on payments
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on expenses;
create policy "Owner full access" on expenses
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on phones;
create policy "Owner full access" on phones
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on message_settings;
create policy "Owner full access" on message_settings
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Authenticated full access" on weekly_charges;
create policy "Owner full access" on weekly_charges
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================
-- 5. Bucket de documentos de cliente: cada usuário só acessa o documento
--    de um cliente que é seu — o caminho do arquivo é "<client_id>/..."
--    (ver uploadClientDocument em actions.ts), então basta checar se esse
--    client_id pertence a um cliente do usuário autenticado.
-- ============================================================
drop policy if exists "Authenticated full access to client-documents" on storage.objects;
create policy "Owner full access to own client-documents" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'client-documents'
    and exists (
      select 1 from clients
      where clients.id::text = (storage.foldername(name))[1]
      and clients.owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'client-documents'
    and exists (
      select 1 from clients
      where clients.id::text = (storage.foldername(name))[1]
      and clients.owner_id = auth.uid()
    )
  );
