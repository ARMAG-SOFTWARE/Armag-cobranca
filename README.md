# Cobrança iPad — MVP

Aplicativo web (PWA, mobile-first, otimizado para iPad/Safari) para gerenciar empréstimos e
vendas parceladas de iPhone: cadastro de clientes, controle de parcelas em estilo planilha e
disparo automático/manual de cobranças via WhatsApp.

## Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + componentes estilo shadcn/ui (Radix UI) + Lucide Icons
- **Backend/Banco**: Supabase (PostgreSQL) — tabelas `clients`, `contracts`, `installments`, `message_settings`, `message_logs`, `weekly_charges`
- **Automação**: Vercel Cron chamando `/api/cron/check-overdue` (diário) e `/api/cron/weekly-dispatch` (fila semanal com anti-banimento)
- **WhatsApp**: módulo com adapters para Meta Cloud API (oficial), Evolution API, Z-API, Twilio e WPPConnect (`src/lib/whatsapp`)

## Estrutura do projeto

```
supabase/migrations/
  0001_init.sql                     # schema do banco (clients, contracts, installments, message_settings, message_logs)
  0002_weekly_dispatch.sql          # tabela weekly_charges (agendamento semanal)
  0003_meta_whatsapp_provider.sql   # provider "meta" + colunas template_name/template_language
src/
  middleware.ts                     # Protege rotas: sem sessão -> /login; com sessão -> fora de /login
  app/
    (app)/                          # Grupo de rotas autenticadas (não afeta a URL)
      layout.tsx                    # Busca o usuário logado e monta o AppNav
      page.tsx                      # Dashboard — tabela de clientes/contratos com busca e filtros
      contracts/[id]/page.tsx       # Detalhe do contrato + grid de parcelas
      settings/page.tsx             # Configuração da API de WhatsApp
    login/page.tsx                  # Tela de login (sem cadastro público — ver seção 1)
    api/cron/check-overdue/route.ts    # Job diário: marca parcelas atrasadas e dispara cobranças (não-semanais)
    api/cron/weekly-dispatch/route.ts  # Fila de cobrança semanal (Evolution API) com anti-banimento
    actions.ts                      # Server actions (CRUD, toggle de status, envio de lembrete)
    auth-actions.ts                 # Server actions de login/logout
  components/
    app-nav.tsx                     # Barra superior fixa (nav + botão de sair)
    login-form.tsx                  # Formulário de login
    clients-table.tsx               # Tabela com busca + abas (Todos/Ativos/Inadimplentes/Quitados)
    new-transaction-dialog.tsx      # Formulário de novo empréstimo/venda
    installments-grid.tsx           # Grid de parcelas com toggle de status e botão de lembrete
    settings-form.tsx               # Formulário de configuração do provedor de WhatsApp
    ui/                             # Componentes base (botão, input, tabela, dialog, etc.)
  lib/
    installments.ts                 # Cálculo das datas/valores de cada parcela
    whatsapp/                       # Adapters de envio (Meta, Evolution, Z-API, Twilio, WPPConnect), spintax, healthchecks
    scheduling/                     # Trava de horário, fila e disparo de cobrança semanal
    supabase/                       # Clients do Supabase (browser, server, middleware, service role)
    types.ts, validations.ts        # Tipos e schemas (zod)
```

## Configuração

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No SQL Editor, rode as migrations em `supabase/migrations/` na ordem numérica (`0001`, `0002`,
   `0003`, ...).
3. Em **Authentication → Providers**, confirme que "Email" está habilitado (é o padrão).
4. Em **Authentication → Users → Add user**, crie o usuário administrador (e-mail + senha) que vai
   operar o app. Marque "Auto Confirm User" para não precisar confirmar por e-mail. **Não existe
   tela de cadastro público no app** — isso é intencional: um cadastro aberto exporia o sistema a
   qualquer pessoa que se registrasse. Para adicionar mais usuários, crie mais contas da mesma
   forma, em **Authentication → Users**.
   Desde a migration `0015`, o sistema é **multiusuário com isolamento total**: cada usuário
   autenticado só enxerga e só edita os próprios clientes, empréstimos, parcelas, pagamentos,
   despesas, vendas de iPhone e configuração de WhatsApp — nunca os de outro usuário, aplicado
   pelas próprias policies de RLS no banco (não só na tela). Cada usuário precisa configurar o
   próprio WhatsApp em **Configurações** depois do primeiro login. `backup_runs`, `message_logs` e
   `audit_logs` continuam compartilhados entre todos os usuários — são logs internos/operacionais,
   nunca exibidos em nenhuma tela do app.
5. Copie `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`
   em Project Settings → API.

> **Esqueceu a senha?** Não há fluxo de "esqueci minha senha" na tela de login ainda. Enquanto
> isso, redefina a senha diretamente em **Authentication → Users**, clicando no usuário e usando
> a opção de redefinir senha.

### 2. Variáveis de ambiente

```bash
cp .env.example .env.local
# preencha com os valores do seu projeto Supabase
```

### 3. Instalar e rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Para testar como PWA no iPad, acesse pelo
Safari e use "Adicionar à Tela de Início".

### 4. Configurar a cobrança via WhatsApp

Acesse a tela **Configurações** (`/settings`) dentro do app e informe as credenciais do provedor
escolhido:

| Provedor                | Campos necessários                                          |
| ------------------------ | ------------------------------------------------------------ |
| **Meta Cloud API** (oficial) | Phone Number ID, Access Token, nome do template aprovado, idioma do template |
| Evolution API            | URL base, API Key, Instance ID                                |
| Z-API                     | URL base, Instance ID, Token                                   |
| Twilio                    | Account SID, Auth Token, número remetente (WhatsApp)          |
| WPPConnect                | URL base, Sessão (Instance ID), Token                          |

O template padrão da mensagem (usado como texto livre pelos provedores não-oficiais, ou como
referência do conteúdo do template aprovado no caso da Meta) é:

> Parcela {numero_parcela} pendente de pagamento.
>
> Valor da parcela: R$ {valor}
> Dias de atraso: {dias_atraso}
> Juros do dia: R$ {juros_dia}
> Data de vencimento: {data_vencimento}
> Valor atualizado da parcela: R$ {valor_atualizado}
>
> Favor enviar o comprovante de pagamento.

Tom firme e direto, sem saudação — nenhuma saudação é adicionada automaticamente no envio.
`{dias_atraso}` e `{juros_dia}` vêm da mesma fórmula de juros de atraso usada no resto do app;
como esta substituição é só texto (sem condicional), eles aparecem mesmo quando a parcela ainda
não está atrasada (como "0"/"R$ 0,00") — na prática isso só é visível se um disparo automático
ocorrer no próprio dia do vencimento, já que o cron diário só dispara para parcela já marcada
"Atrasada".

#### Meta Cloud API (recomendado)

É a API oficial da WhatsApp Business Platform — ao contrário dos demais provedores (que
automatizam o WhatsApp Web e por isso arriscam banimento), ela é sancionada pela própria Meta e
não precisa dos truques de "anti-banimento" (delay randômico, variação de texto). Em troca, exige
um pouco mais de configuração inicial:

1. Crie um app no [Meta for Developers](https://developers.facebook.com/) com o produto
   **WhatsApp Business Platform**, e uma conta comercial (WABA) com o número verificado.
2. Gere um **Access Token de sistema** (permanente, não o token de teste de 24h) e copie o
   **Phone Number ID** do número configurado.
3. No **Meta Business Manager**, crie um **template de mensagem** (categoria *Utility*, ex:
   `lembrete_cobranca`) com **exatamente 4 variáveis no corpo**, nesta ordem: nome do cliente,
   número da parcela, valor e data de vencimento — por exemplo:

   > Olá {{1}}, sua parcela {{2}} no valor de R$ {{3}} com vencimento em {{4}} consta pendente.
   > Entre em contato para regularizar.

   Aguarde a aprovação da Meta (pode levar de minutos a alguns dias).
4. Em Configurações, escolha o provedor **Meta Cloud API**, informe o Phone Number ID, o Access
   Token e o nome/idioma exatos do template aprovado.

O custo é por mensagem (cobrado pela Meta, não pelo app) — na categoria *Utility*, algo em torno
de R$ 0,03/mensagem no Brasil; mensagens de resposta dentro de 24h após o cliente escrever são
gratuitas. Preços mudam com frequência — confira sempre a
[página oficial de preços](https://developers.facebook.com/docs/whatsapp/pricing/) antes de
estimar custo.

### 5. Cron de verificação diária

Ao fazer deploy na Vercel, o arquivo `vercel.json` já registra o cron job
(`/api/cron/check-overdue`, todo dia às 09:00 UTC). Configure a env var `CRON_SECRET` no projeto
Vercel — ela é enviada automaticamente pelo cron como `Authorization: Bearer $CRON_SECRET` e
validada pela rota.

**`CRON_SECRET` é obrigatória** (não apenas recomendada): sem ela configurada, as rotas
`/api/cron/*` respondem sempre `401 Não autorizado` — elas usam a service role key (acesso
total ao banco, ignora RLS) e disparam mensagens reais de WhatsApp, então falham fechadas por
padrão em vez de ficarem abertas por engano.

O job:
1. Marca como **Atrasado** toda parcela **Pendente** cujo vencimento já passou.
2. Recalcula o status geral do contrato (Ativo / Inadimplente / Quitado).
3. Envia a mensagem de cobrança para toda parcela atrasada que ainda não recebeu lembrete no dia.

Fora da Vercel, qualquer scheduler (cron do servidor, GitHub Actions, Supabase Edge Functions
com `pg_cron`, etc.) pode chamar o mesmo endpoint HTTP com o header `Authorization: Bearer
<CRON_SECRET>`.

### 6. Cobrança semanal automática (Meta Cloud API ou Evolution API)

Contratos com periodicidade **Semanal** ganham automaticamente, ao serem cadastrados, um
registro em `weekly_charges` — o dia da semana do disparo (`dia_semana_disparo`) é herdado da
data do 1º vencimento (sábado/domingo são ajustados para sexta/segunda) e `proximo_disparo`
começa nessa mesma data. O pagamento continua controlado manualmente pelos toggles de parcela
já existentes: quando o contrato fica **Quitado** ou **Cancelado**, o `status` da cobrança
semanal é sincronizado automaticamente para `PAGO`/`CANCELADO` e o disparo é abortado.

A fila (`/api/cron/weekly-dispatch`, código em `src/lib/scheduling/`) só está disponível para os
provedores **Meta Cloud API** e **Evolution API** — os demais (Z-API, Twilio, WPPConnect) seguem
funcionando para lembretes manuais e para o `check-overdue` diário, mas não para este disparo
semanal automatizado. A cada execução:

1. **Trava de horário** — só processa de segunda a sexta, das 09:00 às 18:00 (horário de
   Brasília), independente do provedor. Fora disso, encerra sem fazer nada.
2. **Healthcheck do provedor** — Evolution API: confere se a instância está com status `open`;
   Meta Cloud API: confere se o Access Token e o Phone Number ID são válidos. Se falhar, aborta
   o lote inteiro antes de qualquer envio.
3. **Seleção do dia** — busca em `weekly_charges` quem está `PENDENTE`, com
   `dia_semana_disparo` igual a hoje e `proximo_disparo` já vencido.
4. **Para cada cliente da fila**:
   - Refaz o `SELECT` do status **em tempo real**, imediatamente antes de enviar — se alguém
     marcou a parcela como paga ou o contrato como cancelado enquanto a fila rodava, o disparo
     é abortado para aquele cliente.
   - **Evolution API**: monta a mensagem a partir do template configurado em Ajustes e varia o
     texto (frase de encerramento aleatória, além de spintax `{opção 1|opção 2}` no próprio
     template) para reduzir repetição, sem saudação — depois aguarda um
     **delay aleatório de 60 a 120 segundos** antes do próximo cliente.
   - **Meta Cloud API**: envia o template aprovado preenchendo as 4 variáveis (nome, parcela,
     valor, vencimento) — sem variação de texto (não é permitido alterar um template aprovado) e
     com um intervalo mínimo entre envios, já que não há risco de banimento.
   - Envia, registra em `message_logs` e avança `proximo_disparo` em +7 dias.

> **Limite de tempo de execução (Evolution API):** o delay anti-banimento (60-120s por cliente)
> pode facilmente ultrapassar o tempo máximo de uma function serverless. A fila processa em lote
> respeitando um orçamento de tempo e o que sobrar continua pendente (`proximo_disparo` no
> passado), sendo retomado automaticamente na próxima chamada do cron — o processamento é
> idempotente.
>
> **Sobre a frequência do cron:** o plano **Hobby (gratuito) da Vercel só permite crons com
> frequência diária** — uma expressão mais frequente que isso faz o deploy inteiro falhar (erro
> "Hobby accounts are limited to daily cron jobs"). Por isso o `vercel.json` já vem configurado
> com `weekly-dispatch` rodando **1x por dia** (`0 13 * * 1-5`, ~10h de Brasília, seg-sex) em vez
> de a cada 15 minutos. Na prática: com Evolution API, se a carteira de clientes semanais for
> grande o bastante para não caber no orçamento de tempo de uma única invocação, o restante só é
> retomado no dia seguinte (ainda seguro, só atrasa o lembrete em um dia). **Com a Meta Cloud
> API**, sem o delay de 60-120s, isso não é um problema — a fila processa dezenas/centenas de
> clientes em segundos, então 1x/dia é mais que suficiente. Se tiver plano Pro e quiser processar
> várias vezes ao dia (recomendado para volumes grandes com Evolution API), troque a expressão de
> volta para algo como `*/15 12-21 * * 1-5`.

### 7. Backup automático (a cada 6h)

Backup completo do banco + documentos, criptografado, enviado a um armazenamento externo
(Cloudflare R2) via GitHub Actions — roda sozinho, 24/7, sem depender da Vercel nem de
ninguém logado. Configuração completa (secrets do GitHub, migration, teste, restauração) em
**[`BACKUP.md`](./BACKUP.md)**. Histórico das execuções fica visível em `/backups` no app.

## Próximos passos sugeridos

- Fluxo de "esqueci minha senha" self-service na tela de login (hoje é feito manualmente pelo
  Supabase Dashboard — veja a seção 1).
- Edição/exclusão de clientes e contratos.
- Histórico de mensagens enviadas (`message_logs`) na UI.
- Relatórios (total a receber, inadimplência por período).
