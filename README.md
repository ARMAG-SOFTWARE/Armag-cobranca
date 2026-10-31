# Crédito Rápido

Sistema web (PWA, mobile-first) para gestão de **empréstimos** e **venda parcelada de pods**, com
controle de parcelas, pagamentos, quitação, despesas, painel financeiro, "Devedores do Dia" e
cobrança pelo WhatsApp.

Baseado no Recebe/Cobrança: **mesmas telas, menu, componentes e fluxos**. Mudam a identidade
visual (tema verde, nome "Crédito Rápido"; sistema desenvolvido pela ARMAG) e as regras de negócio descritas abaixo. O histórico
das diferenças em relação ao original está em [`ADAPTACOES.md`](./ADAPTACOES.md).

> Este repositório, o banco Supabase, as credenciais e o domínio são **exclusivos** deste
> sistema. Nunca reutilize chaves ou dados de outro projeto.

## Stack

- **Next.js 16** (App Router, Server Actions, `src/proxy.ts`) + React 19 + TypeScript
- **Tailwind CSS v4** + componentes estilo shadcn/ui (Radix) + Lucide
- **Supabase**: Postgres, Auth (e-mail/senha), Storage (bucket privado `client-documents`), RLS por usuário
- **Vercel**: hospedagem e crons (`vercel.json`)
- **Vitest**: testes das regras financeiras e de validação

## Regras de negócio

| Regra | Como funciona |
|---|---|
| Juros do empréstimo | Taxa **por semana**, editável no cadastro (sugestão 7,5%). Total = taxa × duração em semanas: diária = 1/6 de semana por parcela (cobrança de segunda a sábado: 7,5% ÷ 6 por parcela), semanal = 1, quinzenal = 2, mensal = 4. Ex.: R$ 1.000 em 4 semanais, 24 diárias, 2 quinzenais ou 1 mensal = R$ 1.300. Aplicado uma única vez e dividido igualmente entre as parcelas. |
| Juros da venda de pods | Fixo, editável no cadastro (sugestão 20%), sobre o valor do produto menos a entrada. Não depende do número de parcelas. |
| Prazo dos pods | Todas as parcelas devem vencer em **até 4 semanas a partir do 1º vencimento** (máx. 24 diárias, 4 semanais, 2 quinzenais ou 1 mensal). Empréstimo não tem esse limite. |
| Periodicidades | Diária (**de segunda a sábado**; domingo não vence e, se escolhido como 1º vencimento, passa para a segunda; feriado conta), semanal, quinzenal e mensal. |
| Juros de atraso | % **ao dia** sobre o valor total do contrato, para empréstimos e pods. O padrão fica em **Configurações → Regras de cobrança** (inicial: 1%) e é **copiado para cada contrato no cadastro**: mudar a configuração não altera contratos existentes. Na **diária**, o domingo não conta como dia de atraso; nas demais periodicidades contam todos os dias. |
| Cobrança pelo WhatsApp | Manual: o botão abre a conversa com a mensagem pronta. Em **Configurações → Regras de cobrança** escolha como abrir: padrão (`wa.me`), **WhatsApp Business no Android** (abre sempre o app Business, nunca o pessoal) ou **WhatsApp Web** (para iPhone/iPad, com o navegador logado na conta Business). No iPhone/iPad não é possível escolher o app pelo link. |
| Campos do produto | Cor, bateria e IMEI continuam disponíveis e opcionais. |
| Abatimento parcial | Um valor recebido de uma vez é aplicado nas parcelas em aberto, da mais antiga para a mais nova, sem perdoar nada (diferente da quitação total, que encerra a dívida). |
| Renovação de parcela | Paga só o juros de atraso pendente e empurra o vencimento 1 período (na diária, 1 dia de cobrança: de sábado vai para segunda); o principal continua em aberto. |
| Estorno de pagamento | No histórico do contrato, "Estornar" desfaz o pagamento mais recente de uma parcela (valor volta a ficar em aberto). Entrada, quitação total e renovação não são estornáveis. |
| Clientes encerrados | Aba "Encerrados" em Clientes com contratos quitados e cancelados. |
| Senha | Sem "Esqueci minha senha" por enquanto. A troca de senha é feita pela equipe, no Supabase → **Authentication → Users**. |
| Editar periodicidade | Reencaixa só as datas das parcelas em aberto (parcelas com pagamento nunca mudam). O valor combinado do contrato não muda; em pods, a nova agenda ainda precisa caber em 4 semanas. |

Todas as fórmulas ficam em `src/lib/financial-rules.ts` e são cobertas por
`src/lib/financial-rules.test.ts`.

## Colocar no ar (Supabase + Vercel)

### 1. Supabase (projeto novo, exclusivo deste sistema)

1. Em [supabase.com](https://supabase.com), crie um projeto (região **South America (São Paulo)**,
   senha do banco forte, guardada num gerenciador de senhas).
2. **SQL Editor**: rode os arquivos de `supabase/migrations/` **em ordem numérica**
   (`0001` … `0025`). Funcionam num banco vazio, sem usuário criado. Alternativa pela CLI:
   `supabase link --project-ref <ref>` e `supabase db push`.
3. **Authentication → Sign In / Providers**: mantenha "Email" ligado e **desligue "Allow new users
   to sign up"** (não existe cadastro público no app).
4. **Authentication → Users → Add user**: crie o usuário que vai operar o sistema
   ("Auto Confirm User"). Cada usuário só enxerga os próprios dados (RLS).
5. **Authentication → URL Configuration**: Site URL = domínio de produção; adicione o domínio
   em Redirect URLs.
6. **Project Settings → API**: copie URL, `anon` key e `service_role` key para a Vercel (passo 2).

### 1.1. Senha do usuário

O "Esqueci minha senha" foi retirado por enquanto. Para trocar a senha de um usuário, use o
Supabase → **Authentication → Users**. O fluxo antigo (tela, e-mail com `token_hash` e rota
`/auth/confirm`) está no histórico do Git, no commit anterior à remoção, se precisar voltar.

### 2. Vercel (projeto novo, exclusivo deste sistema)

1. **Add New → Project** → importe este repositório.
2. **Environment Variables** (nomes em [`.env.example`](./.env.example)):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e
   `CRON_SECRET` (gere com `openssl rand -hex 32`).
3. Deploy. Os crons de `vercel.json` passam a rodar sozinhos (o plano Hobby só permite crons
   diários, que é o que está configurado).
4. **Settings → Domains**: adicione o domínio e configure o DNS indicado pela Vercel.

### 3. Primeiro acesso

1. Entre com o usuário criado no passo 1.4.
2. **Configurações → Regras de cobrança**: confira o juros de atraso e escolha como abrir o
   WhatsApp (Business).
3. Provedor de WhatsApp por API (envio automático) é **opcional** e não é necessário para a
   cobrança manual.

### 4. Backup

O backup automático (GitHub Actions + Cloudflare R2) fica desligado até ser configurado.
Passo a passo em [`BACKUP.md`](./BACKUP.md). Sem ele, conte com o backup do próprio Supabase
(diário apenas no plano Pro).

## Desenvolvimento

```bash
cp .env.example .env.local   # preencha com um projeto Supabase de TESTE
npm install
npm run dev                  # http://localhost:3000
npm run lint && npm test && npm run build
```

Nunca use dados reais de clientes em desenvolvimento ou testes.

## Rotinas automáticas (crons)

- `/api/cron/check-overdue` (diário): marca parcelas vencidas como atrasadas (nunca de contratos
  cancelados), recalcula o status dos contratos e, **só se houver provedor de WhatsApp por API
  configurado**, envia lembretes automáticos.
- `/api/cron/weekly-dispatch` (dias úteis): fila de cobrança semanal por API (Meta/Evolution).
  Sem provedor configurado, não envia nada.

As duas rotas exigem `Authorization: Bearer $CRON_SECRET` (a Vercel envia sozinha) e respondem
401 sem ele.

## Envio automático por API (opcional, herdado do original)

Em **Configurações → Provedor de WhatsApp** é possível configurar Meta Cloud API (oficial),
Evolution API, Z-API, Twilio ou WPPConnect para envios automáticos. A URL do provedor precisa
ser pública (endereços internos são recusados). A mensagem padrão e as variáveis disponíveis
(`{numero_parcela}`, `{valor}`, `{dias_atraso}`, `{juros_dia}`, `{data_vencimento}`,
`{valor_atualizado}`) aparecem na própria tela.
