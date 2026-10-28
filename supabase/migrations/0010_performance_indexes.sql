-- Otimização de performance: um único índice composto para o padrão de
-- consulta usado por "Devedores do Dia" (parcelas com status pendente,
-- parcial ou atrasado, com due_date <= hoje) — tanto na tela /debtors
-- quanto no card "Devedores de Hoje" do dashboard.
--
-- Os índices individuais `installments_status_idx` e
-- `installments_due_date_idx` (migration 0001) já existem, mas o Postgres
-- só consegue usar um deles com eficiência total para esse predicado
-- combinado (status IN (...) AND due_date <= X); o índice composto abaixo
-- cobre exatamente essa combinação. Migration aditiva: nenhum dado ou
-- índice existente é alterado ou removido.

create index if not exists installments_status_due_date_idx
  on installments (status, due_date);
