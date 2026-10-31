-- ============================================================
-- APAGA OS DADOS FICTÍCIOS DE TESTE — Crédito Rápido
--
-- Remove somente o que foi criado por supabase/seed-teste-usuario.sql:
-- clientes com a observação "[TESTE] Dado fictício" (e, em cascata, os
-- contratos, parcelas, pagamentos e cobranças semanais deles), os
-- produtos vinculados a esses contratos e as despesas marcadas "[TESTE]".
-- Dados de qualquer outro cliente não são tocados.
-- ============================================================
begin;

delete from phones
  where contract_id in (
    select c.id from contracts c join clients cl on cl.id = c.client_id
    where cl.notes = '[TESTE] Dado fictício'
  );

delete from clients where notes = '[TESTE] Dado fictício';

delete from expenses where description like '%[TESTE]%';

commit;

select 'clientes de teste restantes' as item, count(*) as quantidade
  from clients where notes = '[TESTE] Dado fictício'
union all
select 'despesas de teste restantes', count(*) from expenses where description like '%[TESTE]%';
