-- ============================================================
-- SEED DE HOMOLOGAÇÃO — Crédito Rápido
-- ============================================================
-- Dados 100% FICTÍCIOS para o ambiente de homologação isolado (NUNCA rodar
-- em produção). Popula três contas independentes para os testes de
-- isolamento entre usuários (Fase 5 da auditoria):
--
--   Admin A, Usuário B, Admin C
--
-- Cada conta recebe clientes, contratos, parcelas e pagamentos próprios, de
-- modo que dá para verificar na prática se uma conta consegue (indevidamente)
-- ver/alterar dados de outra via API/RLS.
--
-- PRÉ-REQUISITO: os três usuários já devem existir em auth.users (crie-os no
-- painel do Supabase → Authentication → Add user, ou via Admin API — ver
-- HOMOLOGACAO.md). Rode as migrations (0001..0025) ANTES deste seed.
--
-- COMO RODAR (psql), passando os UUIDs reais dos três usuários:
--   psql "$DATABASE_URL" \
--     -v admin_a="00000000-0000-0000-0000-00000000000A" \
--     -v user_b="00000000-0000-0000-0000-00000000000B"  \
--     -v admin_c="00000000-0000-0000-0000-00000000000C" \
--     -f supabase/seed.sql
--
-- Nota técnica: o psql NÃO interpola variáveis (:'x') dentro de blocos
-- dollar-quoted (do $$ ... $$). Por isso passamos os UUIDs para GUCs de
-- sessão com set_config() aqui fora e os lemos com current_setting() lá
-- dentro.
-- ============================================================

\set ON_ERROR_STOP on

select set_config('seed.admin_a', :'admin_a', false);
select set_config('seed.user_b',  :'user_b',  false);
select set_config('seed.admin_c', :'admin_c', false);

do $$
declare
  owners uuid[];
  nomes  text[] := array['Admin A', 'Usuario B', 'Admin C'];
  o uuid;
  nome text;
  v_client uuid;
  v_contract uuid;
  i int;
begin
  owners := array[
    current_setting('seed.admin_a')::uuid,
    current_setting('seed.user_b')::uuid,
    current_setting('seed.admin_c')::uuid
  ];

  -- Pré-requisito: os 3 usuários existem em auth.users.
  foreach o in array owners loop
    if not exists (select 1 from auth.users where id = o) then
      raise exception 'Usuário % não existe em auth.users — crie os 3 antes do seed (ver HOMOLOGACAO.md).', o;
    end if;
  end loop;

  -- Idempotência: limpa só os dados fictícios destes 3 owners (nunca toca em
  -- outros). Ordem respeita as FKs.
  delete from payments        where owner_id = any(owners);
  delete from installments    where owner_id = any(owners);
  delete from phones          where owner_id = any(owners);
  delete from weekly_charges  where owner_id = any(owners);
  delete from contracts       where owner_id = any(owners);
  delete from clients         where owner_id = any(owners);
  delete from message_settings  where owner_id = any(owners);
  delete from business_settings where owner_id = any(owners);

  for i in 1..array_length(owners, 1) loop
    o := owners[i];
    nome := nomes[i];

    -- Cliente fictício
    insert into clients (owner_id, name, phone, email, notes)
    values (o, 'Cliente de '||nome, '479999000'||i, 'cliente'||i||'@exemplo.test', 'Dados fictícios de homologação')
    returning id into v_client;

    -- Business settings (juros padrão 1%/dia, WhatsApp modo padrão)
    insert into business_settings (owner_id, late_interest_rate_percent_per_day, whatsapp_open_mode)
    values (o, 1, 'padrao')
    on conflict (owner_id) do nothing;

    -- Config de WhatsApp DESATIVADA (integração off em homologação)
    insert into message_settings (owner_id, provider, base_url, message_template, is_active)
    values (o, 'evolution', 'https://exemplo-desativado.test',
            'Mensagem de teste {nome_cliente} parcela {numero_parcela}', false);

    -- Contrato: empréstimo de R$ 1.000, 3x mensal
    insert into contracts (owner_id, client_id, type, description, principal_amount, total_amount,
                           installments_count, periodicity, first_due_date, status,
                           interest_rate_percent, late_interest_rate_percent_per_day)
    values (o, v_client, 'emprestimo', 'Empréstimo fictício', 1000, 1000,
            3, 'mensal', current_date + 7, 'ativo', 10, 1)
    returning id into v_contract;

    -- 3 parcelas (a 1ª vira parcial pelo pagamento abaixo)
    insert into installments (owner_id, contract_id, number, amount, due_date, status, paid_principal_amount)
    values
      (o, v_contract, 1, 333.34, current_date + 7,  'parcial',  100),
      (o, v_contract, 2, 333.33, current_date + 37, 'pendente', 0),
      (o, v_contract, 3, 333.33, current_date + 67, 'pendente', 0);

    -- Pagamento parcial fictício na 1ª parcela
    insert into payments (owner_id, installment_id, contract_id, client_id,
                          principal_amount, interest_amount, method, notes, kind)
    select o, id, v_contract, v_client, 100, 0, 'pix', 'Pagamento fictício', 'pagamento'
      from installments where contract_id = v_contract and number = 1;
  end loop;
end $$;

-- Conferência rápida (deve mostrar 1 cliente por owner)
select owner_id, count(*) as clientes
  from clients
 where owner_id in (
   current_setting('seed.admin_a')::uuid,
   current_setting('seed.user_b')::uuid,
   current_setting('seed.admin_c')::uuid
 )
 group by owner_id;
