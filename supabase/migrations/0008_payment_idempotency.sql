-- Protege o registro de pagamento contra duplicidade real: clique duplo,
-- duas abas, reenvio de formulário ou requisição repetida pela rede. O
-- cliente gera uma chave (uuid) por tentativa de pagamento; se a mesma
-- chave chegar duas vezes, o índice único abaixo impede um segundo insert
-- na tabela `payments` — a ação trata esse caso como sucesso (pagamento já
-- processado), sem criar um segundo lançamento nem retornar erro ao usuário.
--
-- Migration aditiva: nenhuma coluna/tabela existente é alterada ou removida.
-- idempotency_key é opcional (nullable) para não quebrar nenhuma linha já
-- existente nem outros fluxos de inserção em `payments` (ex.: entrada de
-- venda de iPhone) que não usam esse mecanismo.

alter table payments add column if not exists idempotency_key uuid;

create unique index if not exists payments_idempotency_key_idx
  on payments (idempotency_key)
  where idempotency_key is not null;
