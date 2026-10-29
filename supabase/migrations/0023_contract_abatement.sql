-- Abatimento parcial de uma dívida (contrato): aplica um valor recebido de
-- uma vez sobre VÁRIAS parcelas em aberto (da mais antiga pra mais nova),
-- sem perdoar nada — o que não for coberto continua em aberto, cobrável
-- normalmente (aparece em Devedores do Dia, lembrete de WhatsApp, etc,
-- exatamente como qualquer parcela parcialmente paga já funciona hoje).
-- É o complemento de `settle_contract_atomic` (migration 0019, que SEMPRE
-- encerra a dívida e perdoa a diferença): aqui a dívida só é encerrada se o
-- valor recebido cobrir tudo — do contrário o contrato continua "ativo"/
-- "inadimplente" normalmente, via a mesma `recalculateContractStatus` já
-- existente.
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada; só uma
-- function nova.
--
-- Diferença chave para `settle_contract_atomic`: em vez de UM pagamento
-- consolidado (`is_settlement`), aqui cada parcela que recebeu alguma parte
-- do valor ganha o seu PRÓPRIO registro em `payments` — exatamente como um
-- pagamento normal registrado parcela por parcela (`register_payment_atomic`,
-- migration 0018), só que todas numa mesma transação, numa única ação do
-- usuário. Uma parcela que não recebeu nada (o valor acabou antes de
-- chegar nela) não gera pagamento de R$0 nem muda de status.
create or replace function apply_contract_abatement_atomic(
  p_contract_id uuid,
  p_owner_id uuid,
  p_client_id uuid,
  -- Array de objetos { id, expected_paid_principal, expected_paid_interest,
  -- expected_status, principal_applied, interest_applied, new_paid_principal,
  -- new_paid_interest, new_status } — uma entrada por parcela em aberto do
  -- contrato, já na ordem em que o valor foi distribuído (mais antiga primeiro).
  p_installments jsonb,
  p_method text,
  p_notes text,
  p_created_by_email text,
  p_idempotency_key uuid
)
returns table (already_existed boolean)
language plpgsql
security invoker
as $$
declare
  v_row record;
  v_existing_payment_id uuid;
  v_idempotency_key_used boolean := false;
  v_current record;
  v_id uuid;
  v_principal_applied numeric;
  v_interest_applied numeric;
begin
  if p_idempotency_key is not null then
    select id into v_existing_payment_id from payments where idempotency_key = p_idempotency_key;
    if v_existing_payment_id is not null then
      return query select true;
      return;
    end if;
  end if;

  for v_row in select value as item from jsonb_array_elements(p_installments)
  loop
    v_id := (v_row.item->>'id')::uuid;
    v_principal_applied := (v_row.item->>'principal_applied')::numeric;
    v_interest_applied := (v_row.item->>'interest_applied')::numeric;

    select paid_principal_amount, paid_interest_amount, status
      into v_current
      from installments
      where id = v_id and contract_id = p_contract_id and owner_id = p_owner_id
      for update;

    if v_current is null then
      raise exception 'installment_not_found';
    end if;

    if v_current.paid_principal_amount is distinct from (v_row.item->>'expected_paid_principal')::numeric
       or v_current.paid_interest_amount is distinct from (v_row.item->>'expected_paid_interest')::numeric
       or v_current.status is distinct from (v_row.item->>'expected_status') then
      raise exception 'installment_changed_concurrently';
    end if;

    update installments set
      paid_principal_amount = (v_row.item->>'new_paid_principal')::numeric,
      paid_interest_amount = (v_row.item->>'new_paid_interest')::numeric,
      status = (v_row.item->>'new_status'),
      paid_at = case when (v_row.item->>'new_status') = 'pago' then now() else paid_at end
    where id = v_id;

    if v_principal_applied > 0 or v_interest_applied > 0 then
      insert into payments (
        owner_id, installment_id, contract_id, client_id,
        principal_amount, interest_amount, method, notes,
        created_by_email, idempotency_key
      ) values (
        p_owner_id, v_id, p_contract_id, p_client_id,
        v_principal_applied, v_interest_applied, p_method, p_notes,
        p_created_by_email, case when v_idempotency_key_used then null else p_idempotency_key end
      );
      v_idempotency_key_used := true;
    end if;
  end loop;

  return query select false;
end;
$$;

grant execute on function apply_contract_abatement_atomic(
  uuid, uuid, uuid, jsonb, text, text, text, uuid
) to authenticated;
