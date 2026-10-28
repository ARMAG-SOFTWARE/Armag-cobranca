# Backup automático — configuração e restauração

Backup completo do banco (Postgres) + documentos dos clientes (Storage),
criptografado e enviado para um armazenamento externo (Cloudflare R2),
rodando a cada 6h via GitHub Actions — independente da Vercel, do
navegador ou de alguém estar logado.

## Arquitetura

```
GitHub Actions (cron a cada 6h)
  -> pg_dump (conexão direta ao Postgres do Supabase, schemas public + auth)
  -> baixa todos os arquivos do bucket privado client-documents
  -> empacota tudo num .tar
  -> criptografa com AES-256-GCM
  -> verifica que consegue descriptografar de volta (nunca sobe um arquivo não verificado)
  -> envia para Cloudflare R2 (backups/6h/, .../daily/, .../monthly/)
  -> aplica a política de retenção
  -> reporta o resultado para /api/backup/report (fica visível em /backups no app)
```

Todo o processamento roda no runner do GitHub Actions — nunca na Vercel,
nunca no navegador. O `pg_dump` lê o banco a partir de um snapshot MVCC
consistente (mecanismo nativo do Postgres) sem bloquear pagamentos nem
qualquer outra escrita simultânea.

## 1. Rodar a migration

No SQL Editor do Supabase, rode `supabase/migrations/0014_backup_runs.sql`
(cria a tabela de histórico `backup_runs` e o campo opcional
`message_settings.admin_alert_phone`).

## 2. Criar a conta e o bucket no Cloudflare R2

1. Crie uma conta grátis em [dash.cloudflare.com](https://dash.cloudflare.com).
2. **R2 Object Storage** → **Create bucket** → nome, ex.: `cobranca-ipad-backups`.
3. **R2 → Manage API tokens** → **Create API token** → permissão restrita a
   **esse bucket específico** (Object Read & Write) — nunca "todos os buckets".
4. Anote: **Account ID**, **Access Key ID**, **Secret Access Key**.

## 3. Pegar a connection string DIRETA do Postgres

No painel do Supabase → **Settings → Database → Connection string** →
escolha **"Direct connection"** (porta 5432) — **não** use o "Transaction
pooler" (porta 6543): `pg_dump` precisa de uma conexão de sessão única
durante toda a execução, que o pooler em modo transação não garante.

## 4. Gerar a chave de criptografia

Rode uma vez, na sua máquina (nunca no código/repositório):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Guarde o resultado em um gerenciador de senhas **além** de colocá-lo no
GitHub Secrets abaixo. **Se você perder essa chave, os backups antigos
não podem mais ser abertos — ela não fica guardada em nenhum outro lugar,
de propósito** (nem no banco, nem no repositório, nem nos logs).

## 5. Configurar os GitHub Secrets

No repositório → **Settings → Secrets and variables → Actions → New
repository secret**, crie cada um destes:

| Secret | Valor |
|---|---|
| `BACKUP_DATABASE_URL` | Connection string DIRETA do Postgres (passo 3) |
| `SUPABASE_URL` | Mesmo valor de `NEXT_PUBLIC_SUPABASE_URL` na Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Mesmo valor de `SUPABASE_SERVICE_ROLE_KEY` na Vercel |
| `BACKUP_ENCRYPTION_KEY` | Gerada no passo 4 |
| `R2_ACCOUNT_ID` | Do passo 2 |
| `R2_ACCESS_KEY_ID` | Do passo 2 |
| `R2_SECRET_ACCESS_KEY` | Do passo 2 |
| `R2_BUCKET_NAME` | Nome do bucket criado no passo 2 |
| `APP_URL` | URL de produção do app (ex.: `https://cobranca-ipad.vercel.app`) |
| `BACKUP_REPORT_SECRET` | Uma string aleatória nova (ex.: gere como no passo 4) |

`BACKUP_REPORT_SECRET` também precisa ser configurada como variável de
ambiente **na Vercel** (Settings → Environment Variables), com o
**mesmo valor**, para o endpoint `/api/backup/report` conseguir validar
quem está chamando — é um segredo próprio, diferente do `CRON_SECRET` já
usado pelos outros crons.

## 6. Testar manualmente antes de confiar no agendamento

No repositório → aba **Actions** → **Backup automático (a cada 6h)** →
**Run workflow**. Acompanhe o log; ao final, confira em **/backups** no
app se a execução aparece como "Concluído".

## 7. Retenção

- Backups de 6 em 6 horas: mantidos por 7 dias.
- O primeiro backup de cada dia (00:00 UTC) também vira o backup "diário": mantido por 30 dias.
- O primeiro backup de cada mês (dia 1º, 00:00 UTC) também vira o "mensal": mantido por 12 meses.

A cópia para as camadas diária/mensal é feita do lado do R2 (sem reenviar
o arquivo), então não duplica processamento. Um backup nunca é apagado se
for o único válido restante na sua camada, mesmo que já tenha passado do
prazo de retenção.

## 8. Alertas de falha

- **Automático, sem configurar nada**: o GitHub envia e-mail para os
  donos do repositório sempre que uma execução agendada falha.
- **Opcional**: preencha "Telefone para alertas" em Ajustes → Alertas de
  sistema para também receber um WhatsApp (reaproveita o provedor já
  configurado ali).
- Toda execução (sucesso ou falha) fica visível em **/backups** no app.

## 9. Restauração

**Nunca é automática.** Rode localmente, na sua máquina:

```bash
cd scripts/backup
npm install
export BACKUP_ENCRYPTION_KEY="..."   # a mesma chave do passo 4
export R2_ACCOUNT_ID="..."
export R2_ACCESS_KEY_ID="..."
export R2_SECRET_ACCESS_KEY="..."
export R2_BUCKET_NAME="..."

node restore.mjs \
  --key "6h/2026-09-20T10-00-00Z.enc" \
  --target-db "postgres://usuario:senha@host:5432/postgres" \
  --documents-dir ./restored-documents
```

- `--key`: qual backup restaurar (veja os nomes/datas no painel do R2, ou
  pelo campo "Destino" na tela **/backups** do app).
- `--target-db`: **sempre obrigatório, nunca tem padrão** — aponte para um
  banco de teste/homologação primeiro. Só use a connection string de
  produção quando tiver certeza absoluta (o script pede confirmação
  explícita antes de executar `pg_restore --clean`, que apaga os objetos
  existentes no banco de destino).
- Documentos são extraídos para `--documents-dir` — reenvie manualmente
  para o bucket `client-documents` do projeto de destino (não é
  automático, por segurança).

Depois de restaurar, confira: quantidade de clientes/empréstimos/parcelas/
pagamentos, valores de fluxo de caixa, vendas de iPhone, e os
relacionamentos cliente → contrato → parcela → pagamento.

## Limitações conhecidas

- O R2 grátis cobre 10GB — acima disso, é cobrado (~US$0,015/GB/mês); para
  este sistema (uma empresa, poucos MB por backup), isso é bem distante.
- O alerta por WhatsApp depende de você já ter um provedor configurado em
  Ajustes — sem isso, só o e-mail do GitHub Actions avisa sobre falhas.
- O agendamento do GitHub Actions pode atrasar alguns minutos em horários
  de pico da própria infraestrutura do GitHub (fora do nosso controle) —
  não afeta a garantia de execução, só a pontualidade exata do minuto 0.
