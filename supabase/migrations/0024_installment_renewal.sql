-- Renovação de parcela: paga só o juros de atraso pendente e empurra o
-- vencimento 1 período para frente, mantendo o principal integralmente em
-- aberto — uso típico de empréstimo informal: "devia 1950 (1500 de
-- principal + 450 de juros), pagou só os 450, renova por mais um mês
-- devendo 1500 de novo (mais o juros que acumular dali pra frente)".
--
-- Diferente de um pagamento normal (`register_payment_atomic`, que sempre
-- aplica o valor primeiro no principal): aqui o valor é SEMPRE 100% juros,
-- nunca reduz `amount`/`paid_principal_amount` da parcela — o principal só
-- diminui através de um pagamento normal (integral ou parcial) feito à
-- parte, quando o usuário quiser.
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada; só uma
-- function nova.
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
    created_by_email, idempotency_key
  ) values (
    p_owner_id, p_installment_id, p_contract_id, p_client_id,
    0, p_interest_amount, p_method, p_notes,
    p_created_by_email, p_idempotency_key
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
