-- Venda de iPhone como operação individual, sem conceito de estoque: cada
-- venda passa a carregar os detalhes do aparelho (cor, saúde da bateria)
-- diretamente, cadastrados junto com a venda em vez de escolhidos de uma
-- lista de "estoque" separada.
--
-- Migration aditiva: nenhuma coluna/tabela existente é alterada ou
-- removida. As colunas de estoque da Fase 2 (status, acquired_at,
-- buyer_name, sale_method, sold_at) continuam existindo — dados antigos
-- não são afetados — mas o novo fluxo sempre cria o registro já vinculado
-- a um contrato, sem passar por um estágio de "em estoque".

alter table phones
  add column if not exists color text,
  add column if not exists battery_percent smallint;

alter table phones
  add constraint phones_battery_percent_check
    check (battery_percent is null or (battery_percent between 0 and 100));
