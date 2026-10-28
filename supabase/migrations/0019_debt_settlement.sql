-- Quitação total de uma dívida (contrato) por um valor possivelmente
-- diferente do saldo devedor atual — o usuário informa quanto recebeu de
-- fato (pode ser um acordo por valor menor, ou o valor integral) e o
-- sistema fecha todas as parcelas restantes de uma vez, registrando o
-- recebimento real no histórico sem nunca inventar que o saldo cheio foi
-- recebido.
--
-- Migration aditiva: nenhuma tabela/coluna existente é removida ou tem seu
-- significado alterado. Duas colunas novas em `payments` (sempre nullable/
-- com default seguro, nenhum backfill necessário — linhas existentes ficam
-- com is_settlement = false, settlement_previous_balance = null, que é
-- exatamente o estado correto pra um pagamento que nunca foi quitação) e
-- uma function nova.
--
-- ============================================================
-- 1. payments.is_settlement / payments.settlement_previous_balance
-- ============================================================
-- `is_settlement`: true só para o UM registro de pagamento criado pela
-- quitação total (nunca para uma parcela normal nem para a entrada) — é
-- como a tela de histórico (payment-history.tsx) e os relatórios
-- distinguem esse evento dos demais. `installment_id` continua null nesse
-- caso, igual à entrada (down payment): o valor fecha várias parcelas de
-- uma vez, nunca uma só.
--
-- `settlement_previous_balance`: o saldo devedor do contrato (principal +
-- juros de atraso de TODAS as parcelas ainda abertas) no instante exato da
-- quitação — só preenchido quando is_settlement. Guardado aqui (em vez de
-- recalculado depois) porque juros de atraso muda com o tempo; sem
-- congelar esse valor no momento da operação, o histórico não conseguiria
-- mostrar de forma confiável "saldo anterior: R$X" mais tarde. A diferença
-- do acordo (quanto foi perdoado) é sempre `settlement_previous_balance −
-- (principal_amount + interest_amount)`, calculada na exibição — nunca
-- guardada numa terceira coluna que poderia divergir.
alter table payments add column if not exists is_settlement boolean not null default false;
alter table payments add column if not exists settlement_previous_balance numeric(12, 2);

alter table payments drop constraint if exists payments_settlement_balance_check;
alter table payments add constraint payments_settlement_balance_check
  check (is_settlement = (settlement_previous_balance is not null));

-- A restrição original (`payments_down_payment_no_interest`) dizia que um
-- pagamento sem parcela vinculada (installment_id null) nunca podia ter
-- juros — verdade para a entrada (down payment), mas uma quitação total
-- também é "sem parcela vinculada" e PODE legitimamente incluir juros de
-- atraso na parte aplicada. Estende a regra em vez de removê-la: continua
-- barrando juros numa entrada comum, só abre exceção para quitação.
alter table payments drop constraint if exists payments_down_payment_no_interest;
alter table payments add constraint payments_down_payment_no_interest
  check (installment_id is not null or is_settlement or interest_amount = 0);

-- ============================================================
-- 2. settle_contract_atomic — quita todas as parcelas em aberto do
--    contrato e grava o pagamento da quitação numa única transação.
-- ============================================================
-- Mesmo padrão de `register_payment_atomic` (migration 0018): `security
-- invoker` (RLS de `payments`/`installments` continua valendo), idempotência
-- verificada antes do lock (chave única, barato), cada parcela travada com
-- `for update` e conferida contra o estado esperado (`expected_*`, lido pelo
-- chamador um instante antes) antes de escrever — se qualquer parcela mudou
-- nesse intervalo (outro pagamento, outra quitação concorrente), a function
-- aborta inteira com 'installment_changed_concurrently' em vez de aplicar um
-- cálculo desatualizado. Isso também fecha sozinho o caso de quitação
-- duplicada: uma segunda tentativa encontraria as parcelas já "pago" (status
-- esperado não bate mais) e abortaria.
--
-- A fórmula financeira (como distribuir o valor recebido entre as parcelas)
-- continua 100% calculada em TypeScript, em
-- `allocateSettlement`/financial-rules.ts — esta function só recebe os
-- valores já calculados e os grava atomicamente, nunca reimplementa a regra
-- em SQL.
create or replace function settle_contract_atomic(
  p_contract_id uuid,
  p_owner_id uuid,
  p_client_id uuid,
  -- Array de objetos { id, expected_paid_principal, expected_paid_interest,
  -- expected_status, new_paid_principal, new_paid_interest } — uma entrada
  -- por parcela ainda em aberto do contrato.
  p_installments jsonb,
  p_principal_amount numeric,
  p_interest_amount numeric,
  p_settlement_previous_balance numeric,
  p_method text,
  p_notes text,
  p_created_by_email text,
  p_idempotency_key uuid
)
returns table (payment_id uuid, already_existed boolean)
language plpgsql
security invoker
as $$
declare
  v_item jsonb;
  v_current record;
  v_existing_payment_id uuid;
  v_new_payment_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing_payment_id from payments where idempotency_key = p_idempotency_key;
    if v_existing_payment_id is not null then
      return query select v_existing_payment_id, true;
      return;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_installments)
  loop
    select paid_principal_amount, paid_interest_amount, status
      into v_current
      from installments
      where id = (v_item->>'id')::uuid and contract_id = p_contract_id and owner_id = p_owner_id
      for update;

    if v_current is null then
      raise exception 'installment_not_found';
    end if;

    if v_current.paid_principal_amount is distinct from (v_item->>'expected_paid_principal')::numeric
       or v_current.paid_interest_amount is distinct from (v_item->>'expected_paid_interest')::numeric
       or v_current.status is distinct from (v_item->>'expected_status') then
      raise exception 'installment_changed_concurrently';
    end if;

    update installments set
      paid_principal_amount = (v_item->>'new_paid_principal')::numeric,
      paid_interest_amount = (v_item->>'new_paid_interest')::numeric,
      status = 'pago',
      paid_at = now()
    where id = (v_item->>'id')::uuid;
  end loop;

  insert into payments (
    owner_id, installment_id, contract_id, client_id,
    principal_amount, interest_amount, method, notes,
    created_by_email, idempotency_key, is_settlement, settlement_previous_balance
  ) values (
    p_owner_id, null, p_contract_id, p_client_id,
    p_principal_amount, p_interest_amount, p_method, p_notes,
    p_created_by_email, p_idempotency_key, true, p_settlement_previous_balance
  )
  returning id into v_new_payment_id;

  return query select v_new_payment_id, false;
end;
$$;

-- Explícito de propósito, igual a 0018 — sem este grant a chamada via
-- `supabase.rpc(...)` (sempre com a sessão do usuário autenticado) falha
-- com "permission denied for function".
grant execute on function settle_contract_atomic(
  uuid, uuid, uuid, jsonb, numeric, numeric, numeric, text, text, text, uuid
) to authenticated;
