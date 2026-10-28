-- Fecha o gap encontrado na auditoria técnica completa (achados #3/#4):
-- `audit_logs` e `message_logs` tinham RLS habilitado mas com policy
-- "para qualquer autenticado" (sem escopo de dono) — diferente das outras
-- 8 tabelas, que já ganharam isolamento por `owner_id` na migration 0015.
-- A migration 0015 deixou essas duas de fora "de propósito" (comentário
-- original: "nunca exibidos em nenhuma tela do app"), mas RLS é a trava
-- real de acesso, não a UI — um usuário autenticado consultando a API
-- diretamente (mesma anon key, sua própria sessão) conseguia ler logs de
-- auditoria e de envio de WhatsApp de QUALQUER outro usuário da conta.
--
-- `backup_runs` fica de fora aqui de propósito (achado de severidade
-- baixa, sem dado financeiro/pessoal — não é o gap que motivou esta
-- migração) e pode ser endereçado depois, separadamente, se desejado.
--
-- Migration aditiva: nenhuma tabela/coluna existente é removida.

-- ============================================================
-- 1. message_logs — mesmo padrão exato de owner_id da migration 0015
--    (coluna, backfill via join, not null, índice, policy "Owner").
--    client_id já existe e sempre aponta para um cliente com owner_id
--    preenchido (migration 0015), então o backfill é direto e completo —
--    nenhuma linha deveria ficar sem dono depois dele.
-- ============================================================
alter table message_logs add column if not exists owner_id uuid references auth.users (id) on delete cascade;

update message_logs ml set owner_id = c.owner_id
  from clients c where c.id = ml.client_id and ml.owner_id is null;

alter table message_logs alter column owner_id set not null;

create index if not exists message_logs_owner_id_idx on message_logs (owner_id);

drop policy if exists "Authenticated full access" on message_logs;
create policy "Owner full access" on message_logs
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================
-- 2. audit_logs — owner_id NULLABLE de propósito: `resource_id` é
--    polimórfico (cliente, contrato, parcela...) e o recurso pode já ter
--    sido excluído quando o log é lido, então não há como inferir o dono
--    de forma confiável por join a partir de hoje em diante — o valor
--    certo é sempre gravado no INSERT (ver src/lib/audit-log.ts), nunca
--    recalculado depois. Linhas já existentes (de antes desta migration)
--    ficam com owner_id NULL — ficam invisíveis para todo mundo via RLS
--    (nunca eram exibidas na UI mesmo, então isso não é uma regressão,
--    só deixa de vazar entre contas) em vez de arriscar atribuir o dono
--    errado com um join especulativo por resource_type/resource_id.
--
--    `login_failed` continua gravado pelo cliente service role (bypassa
--    RLS) antes de existir sessão — owner_id fica NULL ali também, não
--    tem usuário autenticado para atribuir.
-- ============================================================
alter table audit_logs add column if not exists owner_id uuid references auth.users (id) on delete cascade;

create index if not exists audit_logs_owner_id_idx on audit_logs (owner_id);

drop policy if exists "Authenticated can read audit log" on audit_logs;
create policy "Owner can read own audit log" on audit_logs
  for select to authenticated using (owner_id = auth.uid());

-- Trava o INSERT para nunca gravar um owner_id de outra pessoa (defesa em
-- profundidade — a aplicação já só passa o próprio auth.uid() ou NULL).
drop policy if exists "Authenticated can insert audit log" on audit_logs;
create policy "Authenticated can insert own audit log" on audit_logs
  for insert to authenticated with check (owner_id = auth.uid() or owner_id is null);
