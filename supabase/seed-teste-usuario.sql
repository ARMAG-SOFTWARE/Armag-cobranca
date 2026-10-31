-- ============================================================
-- DADOS FICTÍCIOS PARA TESTE — Crédito Rápido
--
-- Cria clientes, empréstimos, vendas de pods, parcelas, pagamentos e
-- despesas FICTÍCIOS para UM usuário de teste, com datas relativas a hoje.
--
-- COMO USAR (Supabase → SQL Editor):
--   1. Crie o usuário de teste em Authentication → Users → Add user.
--   2. Troque o e-mail na linha marcada com  <<< TROQUE AQUI  .
--   3. Cole tudo e clique em Run. O resultado final mostra o resumo.
--
-- SEGURANÇA:
--   - Tudo fica no nome desse usuário (owner_id). Pelas regras de acesso
--     (RLS), nenhum outro usuário — inclusive o do cliente real — vê nada.
--   - Telefones usam DDD "00" (inexistente): o botão do WhatsApp nunca
--     abre conversa com uma pessoa real.
--   - Todo cliente fictício tem a observação "[TESTE]"; para apagar tudo,
--     use supabase/limpar-teste-usuario.sql.
--   - Recusa rodar duas vezes no mesmo usuário (evita duplicar).
--
-- Regras usadas (as mesmas do sistema): empréstimo = taxa semanal × duração
-- em semanas (diária 1/7, semanal 1, quinzenal 2, mensal 4); pod = taxa
-- fixa sobre (valor − entrada); última parcela absorve os centavos;
-- juros de atraso % ao dia sobre o valor do contrato.
-- ============================================================
do $$
declare
  v_email text := 'teste@seudominio.com';  -- <<< TROQUE AQUI pelo e-mail do usuário de teste
  v_owner uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;

  -- Clientes fictícios: nome, telefone (DDD 00), cidade
  v_clients jsonb := '[
    ["Ana Souza [TESTE]", "00911110001", "São Paulo"],
    ["Bruno Lima [TESTE]", "00911110002", "Guarulhos"],
    ["Carla Mendes [TESTE]", "00911110003", "Osasco"],
    ["Diego Alves [TESTE]", "00911110004", "Santo André"],
    ["Eduarda Rocha [TESTE]", "00911110005", "São Paulo"],
    ["Felipe Castro [TESTE]", "00911110006", "Barueri"],
    ["Gabriela Nunes [TESTE]", "00911110007", "São Paulo"],
    ["Henrique Dias [TESTE]", "00911110008", "Diadema"],
    ["Isabela Moreira [TESTE]", "00911110009", "Mauá"],
    ["João Pedro Reis [TESTE]", "00911110010", "São Paulo"],
    ["Larissa Prado [TESTE]", "00911110011", "Carapicuíba"],
    ["Marcos Vieira [TESTE]", "00911110012", "São Paulo"]
  ]';

  -- Contratos: cliente (índice 1..12), tipo, descrição, valor, entrada,
  -- parcelas, periodicidade, dias do 1º vencimento em relação a hoje,
  -- taxa (%/semana no empréstimo; % fixo no pod), juros de atraso %/dia,
  -- parcelas pagas integralmente, valor pago parcial na parcela seguinte,
  -- pagou a última parcela paga com 3 dias de atraso (com juros),
  -- forma de pagamento, cenário especial
  v_contracts jsonb := '[
    [1, "emprestimo", "Capital de giro",            1000, 0, 4,  "semanal",  -21, 7.5, 1,   2, 0,   false, "pix",      null],
    [2, "emprestimo", "Reforma",                    2000, 0, 3,  "mensal",   -40, 7.5, 1,   1, 0,   true,  "pix",      null],
    [3, "emprestimo", "Emergência",                  500, 0, 28, "diaria",   -10, 7.5, 1,   8, 0,   false, "dinheiro", null],
    [4, "emprestimo", "Compra de mercadoria",       1500, 0, 2,  "quinzenal",  5, 7.5, 1,   0, 300, false, "pix",      null],
    [5, "emprestimo", "Pagamento de contas",         800, 0, 4,  "semanal",  -35, 7.5, 1.5, 2, 150, false, "dinheiro", null],
    [6, "emprestimo", "Viagem",                     1200, 0, 2,  "mensal",   -50, 7.5, 1,   2, 0,   false, "pix",      null],
    [7, "emprestimo", "Material de construção",     3000, 0, 4,  "mensal",   -20, 7.5, 1,   0, 0,   false, "pix",      "renovacao"],
    [8, "emprestimo", "Acordo de quitação",         1000, 0, 2,  "quinzenal",-25, 7.5, 1,   0, 0,   false, "pix",      "quitacao"],
    [9, "emprestimo", "Cadastrado por engano",       600, 0, 4,  "semanal",  -14, 7.5, 1,   1, 0,   false, "dinheiro", "cancelado"],
    [10, "venda_iphone", "Pod descartável menta",    100, 0, 4,  "semanal",  -14, 20,  1,   2, 0,   false, "pix",      null],
    [11, "venda_iphone", "Kit pods sabores",          300, 60, 2, "quinzenal", -3, 20,  1,   0, 0,   false, "dinheiro", null],
    [12, "venda_iphone", "Pod recarregável",          150, 0, 28, "diaria",   -5, 20,  1,   4, 0,   false, "pix",      null],
    [1, "venda_iphone", "Pod descartável uva",        80, 0, 1,  "mensal",    10, 20,  1,   0, 0,   false, "pix",      null],
    [5, "venda_iphone", "Pods (2 unidades)",         200, 0, 4,  "semanal",  -28, 20,  1,   4, 0,   false, "dinheiro", null],
    [3, "emprestimo", "Segundo empréstimo",          400, 0, 2,  "semanal",    0, 7.5, 1,   0, 0,   false, "pix",      null]
  ]';

  v_client_ids uuid[] := '{}';
  v_c jsonb;
  v_id uuid;
  v_contract_id uuid;
  v_client_id uuid;
  v_type text; v_desc text; v_principal numeric; v_down numeric; v_count int; v_period text;
  v_first date; v_rate numeric; v_late numeric; v_paid_full int; v_partial numeric;
  v_late_paid boolean; v_method text; v_special text;
  v_weeks numeric; v_base numeric; v_total numeric; v_cents bigint; v_base_cents bigint; v_rem bigint;
  v_amount numeric; v_due date; v_status text; v_paid_principal numeric; v_paid_interest numeric;
  v_paid_at timestamptz; v_interest numeric; v_any_late boolean; v_all_paid boolean; v_contract_status text;
  v_balance numeric; v_received numeric; v_apply numeric; v_inst record; v_wd int;
  i int;
begin
  select id into v_owner from auth.users where lower(email) = lower(v_email);
  if v_owner is null then
    raise exception 'Usuário % não encontrado em Authentication → Users. Crie o usuário de teste e troque o e-mail no início do script.', v_email;
  end if;
  if exists (select 1 from clients where owner_id = v_owner and notes = '[TESTE] Dado fictício') then
    raise exception 'Este usuário já tem os dados fictícios. Rode supabase/limpar-teste-usuario.sql antes de recriar.';
  end if;

  insert into business_settings (owner_id, late_interest_rate_percent_per_day, whatsapp_open_mode)
    values (v_owner, 1, 'padrao')
    on conflict (owner_id) do nothing;

  for v_c in select value from jsonb_array_elements(v_clients) loop
    insert into clients (owner_id, name, phone, city, state, notes)
      values (v_owner, v_c->>0, v_c->>1, v_c->>2, 'SP', '[TESTE] Dado fictício')
      returning id into v_id;
    v_client_ids := v_client_ids || v_id;
  end loop;

  for v_c in select value from jsonb_array_elements(v_contracts) loop
    v_client_id := v_client_ids[(v_c->>0)::int];
    v_type := v_c->>1; v_desc := v_c->>2;
    v_principal := (v_c->>3)::numeric; v_down := (v_c->>4)::numeric;
    v_count := (v_c->>5)::int; v_period := v_c->>6;
    v_first := v_today + (v_c->>7)::int;
    v_rate := (v_c->>8)::numeric; v_late := (v_c->>9)::numeric;
    v_paid_full := (v_c->>10)::int; v_partial := (v_c->>11)::numeric;
    v_late_paid := (v_c->>12)::boolean; v_method := v_c->>13; v_special := v_c->>14;

    -- Juros contratual (mesma regra de calculateFinancedAmount)
    v_weeks := case v_period when 'diaria' then 1.0/7 when 'semanal' then 1 when 'quinzenal' then 2 else 4 end;
    v_base := round(v_principal - v_down, 2);
    v_total := case when v_type = 'emprestimo'
      then round(v_base + round(v_base * (v_count * v_weeks * v_rate) / 100, 2), 2)
      else round(v_base + round(v_base * v_rate / 100, 2), 2) end;

    insert into contracts (owner_id, client_id, type, description, total_amount, principal_amount,
        has_down_payment, down_payment_amount, installments_count, periodicity, first_due_date,
        status, interest_rate_percent, late_interest_rate_percent_per_day, disbursed_at)
      values (v_owner, v_client_id, v_type, v_desc, v_total, v_principal,
        v_down > 0, v_down, v_count, v_period, v_first,
        'ativo', v_rate, v_late, case when v_type = 'emprestimo' then v_first - 7 else null end)
      returning id into v_contract_id;

    -- Parcelas (mesma divisão de splitAmount: a última absorve os centavos)
    v_cents := round(v_total * 100);
    v_base_cents := v_cents / v_count;
    v_rem := v_cents - v_base_cents * v_count;
    v_any_late := false; v_all_paid := true;
    for i in 1..v_count loop
      v_amount := (v_base_cents + case when i = v_count then v_rem else 0 end) / 100.0;
      v_due := case v_period
        when 'diaria' then v_first + (i - 1)
        when 'semanal' then v_first + (i - 1) * 7
        when 'quinzenal' then v_first + (i - 1) * 15
        else (v_first + make_interval(months => i - 1))::date end;
      v_paid_principal := 0; v_paid_interest := 0; v_paid_at := null; v_interest := 0;

      if v_special is null or v_special = 'cancelado' then
        if i <= v_paid_full then
          v_paid_principal := v_amount;
          if v_late_paid and i = v_paid_full then
            v_interest := round(v_principal * v_late / 100 * 3, 2);
            v_paid_interest := v_interest;
            v_paid_at := (v_due + 3) + time '14:00';
          else
            v_paid_at := least(v_due, v_today) + time '14:00';
          end if;
          v_status := 'pago';
        elsif i = v_paid_full + 1 and v_partial > 0 then
          v_paid_principal := least(v_partial, v_amount);
          v_status := case when v_due < v_today then 'atrasado' else 'parcial' end;
        else
          v_status := case when v_due < v_today then 'atrasado' else 'pendente' end;
        end if;
      else
        v_status := case when v_due < v_today then 'atrasado' else 'pendente' end;
      end if;

      insert into installments (owner_id, contract_id, number, amount, due_date, status,
          paid_principal_amount, paid_interest_amount, paid_at)
        values (v_owner, v_contract_id, i, v_amount, v_due, v_status,
          v_paid_principal, v_paid_interest, case when v_status = 'pago' then v_paid_at else null end)
        returning id into v_id;

      -- Pagamento integral da parcela (com juros de atraso, se pago atrasado)
      if v_status = 'pago' then
        insert into payments (owner_id, installment_id, contract_id, client_id, principal_amount,
            interest_amount, method, paid_at, created_at, kind)
          values (v_owner, v_id, v_contract_id, v_client_id, v_amount, v_interest, v_method,
            v_paid_at, v_paid_at, 'pagamento');
      end if;
      -- Pagamento parcial
      if v_paid_principal > 0 and v_status <> 'pago' then
        insert into payments (owner_id, installment_id, contract_id, client_id, principal_amount,
            interest_amount, method, paid_at, created_at, kind)
          values (v_owner, v_id, v_contract_id, v_client_id, v_paid_principal, 0, v_method,
            least(v_due, v_today) + time '11:00', least(v_due, v_today) + time '11:00', 'pagamento');
      end if;
    end loop;

    -- Entrada (venda de pod com entrada)
    if v_down > 0 then
      insert into payments (owner_id, installment_id, contract_id, client_id, principal_amount,
          interest_amount, method, notes, paid_at, created_at, kind)
        values (v_owner, null, v_contract_id, v_client_id, v_down, 0, v_method, 'Entrada',
          (v_first - 7) + time '10:00', (v_first - 7) + time '10:00', 'pagamento');
    end if;

    -- Renovação: cliente pagou só o juros de atraso da 1ª parcela e o
    -- vencimento foi empurrado 1 período (o principal continua em aberto).
    if v_special = 'renovacao' then
      select * into v_inst from installments where contract_id = v_contract_id and number = 1;
      v_interest := round(v_principal * v_late / 100 * 5, 2);
      insert into payments (owner_id, installment_id, contract_id, client_id, principal_amount,
          interest_amount, method, notes, paid_at, created_at, kind)
        values (v_owner, v_inst.id, v_contract_id, v_client_id, 0, v_interest, v_method,
          'Renovação (só juros)', (v_inst.due_date + 5) + time '15:00', (v_inst.due_date + 5) + time '15:00', 'renovacao');
      update installments set
        due_date = (v_inst.due_date + interval '1 month')::date,
        status = case when (v_inst.due_date + interval '1 month')::date < v_today then 'atrasado' else 'pendente' end
        where id = v_inst.id;
    end if;

    -- Quitação total com desconto: o saldo era R$ X, o cliente pagou 90%.
    if v_special = 'quitacao' then
      select sum(amount) into v_balance from installments where contract_id = v_contract_id;
      v_received := round(v_balance * 0.9, 2);
      v_apply := v_received;
      for v_inst in select * from installments where contract_id = v_contract_id order by number loop
        update installments set
          paid_principal_amount = least(v_apply, v_inst.amount),
          status = 'pago',
          paid_at = v_today - 1 + time '16:00'
          where id = v_inst.id;
        v_apply := greatest(v_apply - v_inst.amount, 0);
      end loop;
      insert into payments (owner_id, installment_id, contract_id, client_id, principal_amount,
          interest_amount, method, notes, paid_at, created_at, kind, is_settlement, settlement_previous_balance)
        values (v_owner, null, v_contract_id, v_client_id, v_received, 0, v_method,
          'Acordo de quitação', v_today - 1 + time '16:00', v_today - 1 + time '16:00', 'pagamento', true, v_balance);
    end if;

    -- Status do contrato (mesma regra de recalculateContractStatus)
    select bool_and(status = 'pago'), bool_or(status = 'atrasado') into v_all_paid, v_any_late
      from installments where contract_id = v_contract_id;
    v_contract_status := case
      when v_special = 'cancelado' then 'cancelado'
      when v_all_paid then 'quitado'
      when v_any_late then 'inadimplente'
      else 'ativo' end;
    update contracts set status = v_contract_status where id = v_contract_id;

    -- Venda de pod: produto vinculado (como na tela de cadastro)
    if v_type = 'venda_iphone' then
      insert into phones (owner_id, model, color, cost_amount, status, sale_amount, sold_at, acquired_at, contract_id)
        values (v_owner, v_desc, null, round(v_principal * 0.55, 2), 'vendido', v_principal,
          (v_first - 7) + time '10:00', v_first - 7, v_contract_id);
    end if;

    -- Cobrança semanal (criada pelo sistema para contratos semanais)
    if v_period = 'semanal' then
      v_wd := extract(isodow from v_first)::int;
      v_wd := case when v_wd = 6 then 5 when v_wd = 7 then 1 else v_wd end;
      insert into weekly_charges (owner_id, contract_id, client_id, dia_semana_disparo, proximo_disparo, status)
        values (v_owner, v_contract_id, v_client_id, v_wd, v_first,
          case v_contract_status when 'quitado' then 'PAGO' when 'cancelado' then 'CANCELADO' else 'PENDENTE' end);
    end if;
  end loop;

  -- Despesas fictícias (mês atual e anterior)
  insert into expenses (owner_id, description, category, amount, method, expense_date, notes)
  values
    (v_owner, 'Combustível [TESTE]', 'Transporte', 180.00, 'dinheiro', v_today - 2, null),
    (v_owner, 'Compra de estoque de pods [TESTE]', 'Estoque', 650.00, 'pix', v_today - 6, null),
    (v_owner, 'Internet [TESTE]', 'Contas', 119.90, 'pix', v_today - 12, null),
    (v_owner, 'Manutenção do carro [TESTE]', 'Transporte', 420.00, 'cartao', v_today - 20, null),
    (v_owner, 'Almoço [TESTE]', 'Pessoal', 45.50, 'dinheiro', v_today - 1, null),
    (v_owner, 'Aluguel [TESTE]', 'Contas', 1200.00, 'pix', v_today - 35, 'Mês anterior');
end $$;

-- Resumo do que foi criado para o usuário de teste
select 'clientes' as item, count(*)::text as quantidade from clients where notes = '[TESTE] Dado fictício'
union all select 'contratos — ' || status, count(*)::text from contracts
  where client_id in (select id from clients where notes = '[TESTE] Dado fictício') group by status
union all select 'parcelas — ' || status, count(*)::text from installments
  where contract_id in (select c.id from contracts c join clients cl on cl.id = c.client_id where cl.notes = '[TESTE] Dado fictício') group by status
union all select 'pagamentos', count(*)::text from payments
  where client_id in (select id from clients where notes = '[TESTE] Dado fictício')
union all select 'despesas', count(*)::text from expenses where description like '%[TESTE]%';
