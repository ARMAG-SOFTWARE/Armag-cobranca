# Adaptações em relação ao Recebe/Cobrança

Ponto de partida: snapshot do Recebe/Cobrança (commit `0598474` do repositório original), primeiro
commit deste repositório. Diretriz: **preservar telas, menu, componentes e fluxos**; mudar só a
identidade visual e as regras de negócio pedidas pelo cliente.

Para conferir qualquer diferença: `git diff <primeiro-commit> -- <arquivo>`.

## Correções herdadas do original

| Problema no original | Correção |
|---|---|
| Migration 0015 falhava em banco novo (exigia usuário antes) | Só exige usuário se houver dados antigos para atribuir |
| Índice global permitia uma única configuração de WhatsApp ativa no banco inteiro (2º usuário recebia erro) | Migration 0021: uma ativa **por usuário** |
| Logs de envio de WhatsApp sem `owner_id` (coluna obrigatória) eram descartados | Inserts gravam `owner_id` |
| Cron diário reabria contratos cancelados como inadimplentes e podia cobrá-los | Cancelados ficam fora do cron |
| URL do provedor de WhatsApp aceitava endereços internos (SSRF) | Só URLs http(s) públicas |
| Alerta de backup quebrava com mais de um usuário | Usa uma única configuração com telefone de alerta |

## Regras de negócio

| Item | Original | Este sistema |
|---|---|---|
| Juros do empréstimo | % por **parcela** × nº de parcelas | % por **semana** × duração em semanas (diária = 1/7, semanal = 1, quinzenal = 2, mensal = 4) |
| Periodicidades | semanal, quinzenal, mensal | **+ diária** |
| Juros da venda de produto | nenhum | fixo editável, sugestão 20% |
| Prazo da venda de produto | livre | até 4 semanas a partir do 1º vencimento |
| Juros de atraso | 1%/dia fixo no código, só empréstimo | taxa em Configurações, **gravada em cada contrato**, empréstimo e produto |
| Lucro/pendente das vendas | valor − custo | valor + juros da venda − custo |
| Botão de cobrança | sempre `wa.me` | `wa.me`, WhatsApp Business (Android) ou WhatsApp Web, escolhido em Configurações |

Banco: migration `0022_armag_business_rules.sql` (periodicidade diária, juros de atraso por
contrato, tabela `business_settings` com RLS).

## Recursos trazidos do Recebe depois da cópia inicial

Portados do Recebe/Cobrança (commits `f32c7b5`, `ff7e2db`, `33dbf92` e `d98ee76` do
repositório original), adaptados às regras deste sistema:

| Recurso | Adaptação no ARMAG |
|---|---|
| Abatimento parcial de dívida | Usa a taxa de atraso gravada no contrato |
| Editar periodicidade do contrato | Inclui "diária"; em pods, recusa se a nova agenda passar de 4 semanas |
| Renovação de parcela (paga só o juros) | Usa a taxa de atraso do contrato; vale também para pods, que aqui têm juros de atraso |
| Lucro da quitação total no painel | A entrada (down payment) continua sem gerar lucro, mesmo em pods com juros |

Migrations renumeradas para `0023_contract_abatement.sql` e `0024_installment_renewal.sql`
(aqui `0021` e `0022` já existiam).

Como a periodicidade pode ser corrigida depois do cadastro, o juros exibido no painel e no
contrato passou a ser calculado a partir do valor salvo (total financiado − base), e não
refazendo a fórmula semanal (`storedContractMarkup` em `src/lib/financial-rules.ts`).

## Interface

- Mesmas telas e navegação. Acréscimos pontuais: cartão "Regras de cobrança" em Configurações;
  campo de juros também na venda de produto; taxa de atraso exibida no contrato.
- Identidade: nome provisório "ARMAG" e tema verde, centralizados em `src/lib/brand.ts`,
  `src/app/globals.css`, `public/manifest.json` e ícones em `public/`.
- Textos de exemplo trocados de iPhone para pods. Nenhum campo removido.

## Infraestrutura

- `.env.example` com os nomes das variáveis (sem valores).
- CI (`.github/workflows/ci.yml`): lint, testes e build a cada push/PR.
- Backup automático desligado até `BACKUP_ENABLED=true` (ver `BACKUP.md`).
