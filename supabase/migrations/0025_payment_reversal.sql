-- ============================================================
-- Estorno de pagamento
--
-- 1. `payments.kind`: distingue a renovação de parcela (que muda o
--    vencimento e zera o juros pago) de um pagamento comum. A renovação é
--    redefinida abaixo para gravar kind = 'renovacao'.
-- 2. `reverse_payment_atomic`: desfaz um pagamento lançado errado, numa
--    única transação — devolve o principal/juros à parcela, recalcula o
--    status dela e apaga o pagamento. Só é permitido para o pagamento MAIS
--    RECENTE de uma parcela, e nunca para entrada, quitação total
--    (is_settlement, que perdoa saldo em várias parcelas) ou renovação —
--    nesses casos o estado anterior não é recuperável com segurança.
-- ============================================================

alter table payments add column if not exists kind text not null default 'pagamento';
alter table payments drop constraint if exists payments_kind_check;
alter table payments add constraint payments_kind_check check (kind in ('pagamento', 'renovacao'));

-- Renovações feitas antes desta migration (pagamento só de juros, sem
-- principal, numa parcela) passam a ser identificadas como tal — assim
-- nunca são oferecidas para estorno.
update payments set kind = 'renovacao'
  where kind = 'pagamento' and installment_id is not null and is_settlement = false
    and principal_amount = 0 and interest_amount > 0;

create or replace function renew_installment_atomic(
  p_installment_id uuid,
  p_owner_id uuid,
  p_contract_id uuid,
  p_client_id uuid,
  p_interest_amount numeric,
  p_new_due_date date,
  p_new_status text,
  p_expected_paid_principal numeric,
  p_expected_paid_interest numeric,
  p_expected_status text,
  p_expected_due_date date,
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

  select paid_principal_amount, paid_interest_amount, status, due_date
    into v_current
    from installments
    where id = p_installment_id and contract_id = p_contract_id and owner_id = p_owner_id
    for update;

  if v_current is null then
    raise exception 'installment_not_found';
  end if;

  if v_current.paid_principal_amount is distinct from p_expected_paid_principal
     or v_current.paid_interest_amount is distinct from p_expected_paid_interest
     or v_current.status is distinct from p_expected_status
     or v_current.due_date is distinct from p_expected_due_date then
    raise exception 'installment_changed_concurrently';
  end if;

  insert into payments (
    owner_id, installment_id, contract_id, client_id,
    principal_amount, interest_amount, method, notes,
    created_by_email, idempotency_key, kind
  ) values (
    p_owner_id, p_installment_id, p_contract_id, p_client_id,
    0, p_interest_amount, p_method, p_notes,
    p_created_by_email, p_idempotency_key, 'renovacao'
  )
  returning id into v_new_payment_id;

  -- paid_principal_amount nunca muda aqui — só o juros é quitado. O "crédito"
  -- de juros pago (paid_interest_amount) volta a zero porque o vencimento
  -- avança: o juros de atraso passa a contar de novo a partir da NOVA data,
  -- não da antiga — sem isso, `calculateLateInterest` (TypeScript) ficaria
  -- comparando o juros futuro com um crédito acumulado de ciclos anteriores
  -- e nunca voltaria a cobrar nada.
  update installments set
    due_date = p_new_due_date,
    paid_interest_amount = 0,
    status = p_new_status
  where id = p_installment_id;

  return query select v_new_payment_id, false;
end;
$$;

grant execute on function renew_installment_atomic(
  uuid, uuid, uuid, uuid, numeric, date, text, numeric, numeric, text, date, text, text, text, uuid
) to authenticated;

create or replace function reverse_payment_atomic(
  p_payment_id uuid,
  p_owner_id uuid,
  p_today date
)
returns table (contract_id uuid, installment_id uuid, new_status text)
language plpgsql
security invoker
as $$
declare
  v_payment record;
  v_installment record;
  v_new_principal numeric;
  v_new_interest numeric;
  v_status text;
begin
  select p.id, p.installment_id, p.contract_id, p.principal_amount, p.interest_amount,
         p.is_settlement, p.kind, p.paid_at, p.created_at
    into v_payment
    from payments p
    where p.id = p_payment_id and p.owner_id = p_owner_id
    for update;

  if v_payment is null then
    raise exception 'payment_not_found';
  end if;
  if v_payment.is_settlement then
    raise exception 'settlement_not_reversible';
  end if;
  if v_payment.installment_id is null then
    raise exception 'down_payment_not_reversible';
  end if;
  if v_payment.kind = 'renovacao' then
    raise exception 'renewal_not_reversible';
  end if;

  select i.id, i.amount, i.paid_principal_amount, i.paid_interest_amount, i.due_date
    into v_installment
    from installments i
    where i.id = v_payment.installment_id and i.owner_id = p_owner_id
    for update;

  if v_installment is null then
    raise exception 'installment_not_found';
  end if;

  if exists (
    select 1 from payments p
    where p.installment_id = v_payment.installment_id
      and p.id <> v_payment.id
      and (p.paid_at > v_payment.paid_at
           or (p.paid_at = v_payment.paid_at and p.created_at > v_payment.created_at))
  ) then
    raise exception 'not_latest_payment';
  end if;

  v_new_principal := greatest(v_installment.paid_principal_amount - v_payment.principal_amount, 0);
  v_new_interest := greatest(v_installment.paid_interest_amount - v_payment.interest_amount, 0);

  if v_new_principal >= v_installment.amount then
    v_status := 'pago';
  elsif v_installment.due_date < p_today then
    v_status := 'atrasado';
  elsif v_new_principal > 0 then
    v_status := 'parcial';
  else
    v_status := 'pendente';
  end if;

  update installments set
    paid_principal_amount = v_new_principal,
    paid_interest_amount = v_new_interest,
    status = v_status,
    paid_at = case when v_status = 'pago' then paid_at else null end
  where id = v_installment.id;

  delete from payments where id = v_payment.id;

  return query select v_payment.contract_id, v_payment.installment_id, v_status;
end;
$$;

grant execute on function reverse_payment_atomic(uuid, uuid, date) to authenticated;
