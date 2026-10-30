# Homologação isolada — guia de setup (auditoria de segurança)

Ambiente separado de produção para rodar o **pentest ativo** (Fases 4/5 da
auditoria) sem risco a dados reais. Produção continua **somente leitura**.

> Regra de ouro: **nada** de credencial, dado ou integração de produção aqui.
> Projeto Supabase separado, deploy Vercel separado, dados fictícios,
> integrações desligadas.

## 1. Projeto Supabase independente

1. Crie um **novo projeto** no Supabase (não reutilize o de produção).
2. Rode as migrations na ordem (`supabase/migrations/0001…0025`):
   - Via Supabase CLI: `supabase link --project-ref <ref-homolog>` e `supabase db push`; ou
   - Cole cada arquivo no SQL Editor, em ordem.
   - Em banco vazio, a migration `0015` (backfill multi-tenant) é no-op — ela
     só age se já houver linhas sem dono, então roda limpa aqui.
3. Crie o bucket de Storage **privado** `client-documents` (igual produção).

## 2. Três usuários de teste

Crie em **Authentication → Add user** (ou via Admin API) três usuários
fictícios e anote os UUIDs:

| Papel | E-mail sugerido | UUID (anote) |
|---|---|---|
| Admin A | `admin-a@exemplo.test` | … |
| Usuário B | `user-b@exemplo.test` | … |
| Admin C | `admin-c@exemplo.test` | … |

> O sistema é isolado por `owner_id = auth.uid()` (não há papéis/roles no
> banco — "Admin" vs "Usuário" aqui é só rótulo de teste; todos são contas
> equivalentes). O que o pentest valida é se **uma conta enxerga/altera os
> dados de outra**.

## 3. Popular dados fictícios

Com as migrations aplicadas e os 3 usuários criados:

```bash
psql "$DATABASE_URL_HOMOLOG" \
  -v admin_a="<uuid Admin A>" \
  -v user_b="<uuid Usuário B>" \
  -v admin_c="<uuid Admin C>" \
  -f supabase/seed.sql
```

Cada conta fica com 1 cliente, 1 empréstimo (3 parcelas) e 1 pagamento
parcial — próprios e independentes.

## 4. Deploy Vercel independente

1. Novo projeto Vercel (ou um alias/branch de preview dedicado) apontando
   para este repositório.
2. Variáveis de ambiente: use **`.env.homologacao.example`** como modelo.
   `CRON_SECRET`/`BACKUP_REPORT_SECRET` **novos** (nunca os de produção).
3. **Integrações externas desligadas**: não configure provedor real de
   WhatsApp. O seed já deixa `message_settings.is_active = false` apontando
   para um host fictício — nenhum disparo real ocorre.

## 5. Checklist antes de liberar o pentest ativo

- [ ] Projeto Supabase separado, com as 25 migrations aplicadas
- [ ] Bucket `client-documents` privado criado
- [ ] 3 usuários criados e UUIDs anotados
- [ ] `seed.sql` rodado (cada conta com dados próprios)
- [ ] Deploy Vercel separado, com env de homologação (segredos próprios)
- [ ] WhatsApp/integrações **desligados** (nenhum disparo real possível)
- [ ] Confirma que a URL de homologação **não** é a de produção

## 6. Roteiro de testes ativos (só aqui, nunca em produção)

Isolamento entre contas (Fase 5) — autenticado como Admin A, tentar via API
(não só pela UI) sobre dados do Usuário B / Admin C:

1. Visualizar clientes de outra conta
2. Consultar empréstimos/parcelas de terceiros
3. Alterar pagamentos / quitar dívida de terceiros
4. Manipular valores (parcela, juros)
5. Consultar produtos/IMEIs de outra conta
6. Acessar documento (Storage) de cliente de outra conta
7. Chamar as RPCs (`register_payment_atomic`, `settle_contract_atomic`,
   `reverse_payment_atomic`, …) passando `p_owner_id`/IDs de outra conta
8. Ler `audit_logs` / `message_logs` / `backup_runs` de outra conta
9. Consultar dados após logout (sessão/caché)
10. Manipular a requisição HTTP diretamente (não confiar na proteção visual)

SSRF (após o PR de hardening): configurar `base_url` de WhatsApp para um
domínio que **resolve** para IP interno, e para um host que **redireciona**
para IP interno — confirmar bloqueio nos dois casos.

> A expectativa (pela análise estática) é que o RLS + as RPCs `security
> invoker` barrem de 1 a 8. O pentest existe para **comprovar** isso na
> prática, não para presumir.
