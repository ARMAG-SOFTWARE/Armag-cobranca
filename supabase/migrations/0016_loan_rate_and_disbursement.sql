-- Fase 5: duas mudanças pedidas pelo cliente depois de conversar com o
-- usuário (sem conseguir fechar o questionário formal):
--
-- 1) Juros do empréstimo deixa de ser fixo em código (7,5%/parcela) e passa
--    a ser escolhido manualmente a cada cadastro, guardado em
--    `interest_rate_percent` — o valor digitado pelo usuário (sugestão
--    inicial de 7,5% no formulário, mas livre para alterar). Continua
--    multiplicado pela quantidade de parcelas, igual à regra anterior; só a
--    origem do percentual por parcela deixa de ser uma constante global.
--    Venda de produto ignora esta coluna (nunca tem juros automático).
--
-- 2) Fluxo de caixa com débito automático do dinheiro emprestado: cada
--    empréstimo ganha `disbursed_at` (data em que o dinheiro realmente saiu
--    da conta). NULL = "ainda vai sair" (não debita o saldo geral ainda);
--    preenchida = "já saiu" (debita o valor emprestado do saldo geral na
--    data informada). O usuário escolhe e edita essa data livremente, nunca
--    é inferida automaticamente — exatamente para não haver débito
--    duplicado nem empréstimo "fantasma" contando no caixa antes de o
--    dinheiro ter saído de fato.
--
-- Migration aditiva: nenhuma coluna/tabela existente é alterada ou removida.
-- Backfill: empréstimos já cadastrados são históricos — o dinheiro já saiu
-- de fato da conta há tempos, então marcamos `disbursed_at` com a data de
-- criação do contrato (nunca NULL), para não fazer o saldo geral cair de
-- repente ao publicar esta migration contando tudo como "pendente".

alter table contracts add column if not exists interest_rate_percent numeric not null default 7.5;

-- O backfill só roda na primeira vez (quando a coluna ainda não existe):
-- depois que ela existe, um `disbursed_at` NULL passa a significar "o
-- dinheiro ainda vai sair" (escolha do usuário) e não pode ser sobrescrito
-- se esta migração for executada de novo.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contracts' and column_name = 'disbursed_at'
  ) then
    alter table contracts add column disbursed_at date;
    update contracts set disbursed_at = created_at::date where type = 'emprestimo';
  end if;
end $$;
