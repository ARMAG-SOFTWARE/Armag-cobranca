-- Fase 4: nova regra de juros dos empréstimos (7,5% por parcela, aplicada
-- no código em src/lib/financial-rules.ts — venda de iPhone deixa de ter
-- juros automático, sem necessidade de mudança de schema) e trilha de
-- auditoria de quem registrou cada pagamento/saída, já que o sistema tem
-- autenticação.
--
-- Migration aditiva: nenhuma coluna/tabela existente é alterada ou removida.

alter table payments add column if not exists created_by_email text;
alter table expenses add column if not exists created_by_email text;
