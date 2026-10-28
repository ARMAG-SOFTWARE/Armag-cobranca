-- Log de auditoria (itens 22-23 da auditoria de segurança): rastreia quem
-- fez o quê em operações sensíveis (login, exclusão de contrato, pagamento,
-- documentos). NUNCA armazena senha/token/secret — só metadados já seguros
-- (IDs, valores monetários, e-mail de quem realizou a ação).
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada.

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_email text,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb
);

create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on audit_logs (action);
create index if not exists audit_logs_resource_idx on audit_logs (resource_type, resource_id);

alter table audit_logs enable row level security;

-- Só leitura e inserção — nunca update/delete. Um log de auditoria que
-- pudesse ser editado ou apagado pela própria aplicação perderia o
-- propósito (detectar alteração indevida). Mesmo um usuário autenticado
-- não consegue alterar/excluir uma linha já gravada por aqui.
create policy "Authenticated can read audit log" on audit_logs
  for select to authenticated using (true);

create policy "Authenticated can insert audit log" on audit_logs
  for insert to authenticated with check (true);
