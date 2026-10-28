-- Histórico de execuções do backup automático (item 13 da auditoria de
-- backup: área de consulta, sem expor caminhos/credenciais). Cada linha é
-- uma execução do workflow de backup (GitHub Actions, a cada 6h) reportando
-- o resultado via /api/backup/report — nunca contém a chave de criptografia,
-- a connection string do banco nem as credenciais do armazenamento externo.
--
-- Migration aditiva: nenhuma tabela/coluna existente é alterada.

create table if not exists backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  -- Camada de retenção que este backup alimenta (item 6): todo backup vira
  -- "6h"; o primeiro de cada dia também vira "daily"; o primeiro do mês
  -- também vira "monthly" (cópia do lado do armazenamento, sem duplicar
  -- processamento).
  tiers text[] not null default '{}',
  size_bytes bigint,
  duration_seconds integer,
  -- Identificação do destino (ex.: "r2:cobranca-ipad-backups/6h/2026-09-20T10-00-00Z.enc")
  -- — nunca a URL assinada nem a credencial de acesso.
  destination text,
  -- SHA-256 do arquivo ANTES da criptografia — usado para conferir
  -- integridade depois de uma restauração futura.
  checksum text,
  -- Resultado de cada etapa de verificação (item 7), nunca dado sensível:
  -- {"dump_ok": true, "documents_ok": true, "encryption_ok": true, "upload_ok": true}
  validation jsonb,
  -- Mensagem de erro já saneada (nunca stack trace bruto, connection
  -- string ou credencial) — ver scripts/backup/backup.mjs.
  error_message text,
  restore_tested boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists backup_runs_started_at_idx on backup_runs (started_at desc);
create index if not exists backup_runs_status_idx on backup_runs (status);

alter table backup_runs enable row level security;

-- Mesmo padrão de audit_logs: só leitura e inserção pela aplicação (o
-- endpoint /api/backup/report usa a service role, que ignora RLS de
-- propósito — é um processo de sistema, não uma ação de usuário). Usuários
-- autenticados normais só podem ler, nunca alterar/apagar uma execução já
-- registrada.
create policy "Authenticated can read backup runs" on backup_runs
  for select to authenticated using (true);

-- Telefone opcional para alertas de sistema (hoje só falha de backup) via o
-- mesmo provedor de WhatsApp já configurado em message_settings — reaproveita
-- a integração existente em vez de criar um canal de notificação novo. Sem
-- preencher, o alerta por WhatsApp simplesmente não é enviado (o e-mail
-- automático do GitHub Actions em toda execução com falha continua
-- funcionando de qualquer forma, sem depender deste campo).
alter table message_settings
  add column if not exists admin_alert_phone text;
