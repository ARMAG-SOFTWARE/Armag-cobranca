-- Fecha o achado de maior severidade da auditoria técnica completa:
-- `registerPayment` fazia DOIS writes sequenciais e independentes (insert
-- em `payments`, depois update em `installments`) sem nenhuma transação —
-- uma falha de rede/processo entre os dois deixava o pagamento gravado
-- sem a parcela refletir isso, e a checagem de idempotência (feita ANTES
-- do insert, sem lock) não fechava a corrida entre dois pagamentos
-- concorrentes na mesma parcela.
--
-- Esta function faz os dois writes dentro de UMA chamada (uma transação
-- implícita do Postgres) e trava a linha da parcela (`for update`) do
-- início ao fim — a segunda chamada concorrente só continua depois que a
-- primeira termina, e nesse ponto vê o estado já atualizado.
--
-- Decisão de design: a FÓRMULA financeira (juros, split principal/juros,
-- novo status) continua 100% calculada em TypeScript, em
-- `src/lib/financial-rules.ts` — a única fonte de verdade do sistema para
-- isso (ver `## financial rules` no CLAUDE.md implícito pela arquitetura
-- já auditada). Esta function só recebe os valores já calculados e os
-- grava atomicamente — nunca reimplementa a regra de juros em SQL, o que
-- criaria uma segunda fonte de verdade divergente.
--
-- Proteção contra corrida (concorrência real, não só falha de rede): os
-- parâmetros `p_expected_*` são o estado da parcela que o chamador leu
-- ANTES de calcular os valores. Sob o lock, a function confere se esse
-- estado ainda é o mesmo — se outra chamada já mudou a parcela nesse
-- intervalo, aborta com 'installment_changed_concurrently' em vez de
-- aplicar um cálculo potencialmente desatualizado; o chamador recalcula e
-- tenta de novo (nunca silenciosamente aceita um valor errado).
--
-- `security invoker` (padrão do Postgres, explícito aqui) — a function
-- roda com o papel/sessão de quem chama, então a RLS de `payments` e
-- `installments` continua se aplicando normalmente dentro dela; nenhum
-- bypass de RLS é introduzido.
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada ou
-- removida; só uma function nova.

create or replace function register_payment_atomic(
  p_installment_id uuid,
  p_owner_id uuid,
  p_contract_id uuid,
  p_client_id uuid,
  p_principal_portion numeric,
  p_interest_portion numeric,
  p_method text,
  p_notes text,
  p_created_by_email text,
  p_idempotency_key uuid,
  p_expected_paid_principal numeric,
  p_expected_paid_interest numeric,
  p_expected_status text,
  p_new_paid_principal numeric,
  p_new_paid_interest numeric,
  p_new_status text,
  p_new_paid_at timestamptz
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
  -- Idempotência: se já existe um pagamento com esta chave (ex.: reenvio
  -- da mesma tentativa), devolve o id já existente em vez de inserir de
  -- novo. Checado ANTES do lock da parcela de propósito — não precisa de
  -- lock para ler por uma chave única.
  if p_idempotency_key is not null then
    select id into v_existing_payment_id from payments where idempotency_key = p_idempotency_key;
    if v_existing_payment_id is not null then
      return query select v_existing_payment_id, true;
      return;
    end if;
  end if;

  -- Trava a linha da parcela até o fim desta transação (commit ou
  -- rollback) — uma segunda chamada concorrente para a MESMA parcela
  -- bloqueia aqui até esta terminar, nunca lê um estado "no meio do
  -- caminho". O filtro por owner_id replica a mesma restrição que a RLS
  -- já aplicaria — redundante de propósito, nunca depende só da RLS para
  -- esta checagem específica de concorrência.
  select paid_principal_amount, paid_interest_amount, status
    into v_current
    from installments
    where id = p_installment_id and owner_id = p_owner_id
    for update;

  if v_current is null then
    raise exception 'installment_not_found';
  end if;

  if v_current.paid_principal_amount is distinct from p_expected_paid_principal
     or v_current.paid_interest_amount is distinct from p_expected_paid_interest
     or v_current.status is distinct from p_expected_status then
    raise exception 'installment_changed_concurrently';
  end if;

  insert into payments (
    owner_id, installment_id, contract_id, client_id,
    principal_amount, interest_amount, method, notes,
    created_by_email, idempotency_key
  ) values (
    p_owner_id, p_installment_id, p_contract_id, p_client_id,
    p_principal_portion, p_interest_portion, p_method, p_notes,
    p_created_by_email, p_idempotency_key
  )
  returning id into v_new_payment_id;

  update installments set
    paid_principal_amount = p_new_paid_principal,
    paid_interest_amount = p_new_paid_interest,
    status = p_new_status,
    paid_at = p_new_paid_at
  where id = p_installment_id;

  return query select v_new_payment_id, false;
end;
$$;

-- Explícito de propósito — não depende do privilégio padrão (EXECUTE a
-- PUBLIC) de uma function nova, que pode variar por configuração do
-- projeto Supabase. Sem este grant, a chamada via `supabase.rpc(...)`
-- (sempre com a sessão do usuário autenticado, nunca service role) falha
-- com "permission denied for function".
grant execute on function register_payment_atomic(
  uuid, uuid, uuid, uuid, numeric, numeric, text, text, text, uuid,
  numeric, numeric, text, numeric, numeric, text, timestamptz
) to authenticated;
