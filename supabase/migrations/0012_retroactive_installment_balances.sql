-- Correção retroativa (dados, não schema): recalcula o saldo principal
-- pago e o juros pago de cada parcela que JÁ recebeu algum pagamento,
-- aplicando a mesma regra corrigida na migration 0011 (o pagamento cobre
-- primeiro o principal da parcela, até o valor original dela, e só o que
-- sobrar — se sobrar — conta como juros pago).
--
-- NÃO reescreve nenhuma linha da tabela `payments` — o histórico de cada
-- pagamento já registrado (quanto foi de principal/juros naquele momento)
-- permanece exatamente como estava. Só o saldo/status ATUAIS de cada
-- parcela (e, por consequência, do contrato) são corrigidos.
--
-- Idempotente: pode ser rodada mais de uma vez sem efeito colateral — o
-- resultado depende só da soma dos pagamentos já existentes, nunca de si
-- mesma (não há acúmulo/duplicação possível).

begin;

-- 1) Saldo principal pago e juros pago de cada parcela, a partir da soma
--    real de tudo que já foi pago para ela (principal + juros de cada
--    pagamento, somados). O pagamento cobre o principal primeiro, até o
--    valor original da parcela; o que sobrar (se sobrar) vira juros pago.
with totals as (
  select installment_id, sum(principal_amount + interest_amount) as total_paid
  from payments
  where installment_id is not null
  group by installment_id
)
update installments i
set
  paid_principal_amount = least(t.total_paid, i.amount),
  paid_interest_amount = greatest(t.total_paid - i.amount, 0)
from totals t
where t.installment_id = i.id
  and (
    i.paid_principal_amount <> least(t.total_paid, i.amount)
    or i.paid_interest_amount <> greatest(t.total_paid - i.amount, 0)
  );

-- 2) Parcelas cujo principal ficou 100% coberto (mas que ainda não
--    estavam marcadas como "pago") passam para "pago". paid_at usa a data
--    do último pagamento já registrado para essa parcela.
update installments
set
  status = 'pago',
  paid_at = coalesce(paid_at, (
    select max(p.paid_at) from payments p where p.installment_id = installments.id
  ))
where paid_principal_amount >= amount
  and status <> 'pago';

-- 3) Contratos (não cancelados) cujas parcelas ficaram TODAS pagas viram
--    "quitado" — só promove o status, nunca rebaixa.
update contracts c
set status = 'quitado'
where c.status in ('ativo', 'inadimplente')
  and exists (select 1 from installments i where i.contract_id = c.id)
  and not exists (
    select 1 from installments i where i.contract_id = c.id and i.status <> 'pago'
  );

-- 4) Disparo semanal sincronizado para os contratos que acabaram de virar
--    "quitado" (mesmo padrão já usado por `syncWeeklyChargeStatus`).
update weekly_charges w
set status = 'PAGO'
from contracts c
where w.contract_id = c.id
  and c.status = 'quitado'
  and w.status <> 'PAGO';

commit;
