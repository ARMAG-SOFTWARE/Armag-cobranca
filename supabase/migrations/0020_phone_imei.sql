-- IMEI do aparelho vendido (celular) — identificador físico da unidade,
-- útil para suporte/bloqueio legítimo junto à operadora quando necessário.
-- O sistema aqui só guarda e exibe o identificador: nenhum bloqueio remoto
-- nem integração com operadora é implementado.
--
-- Migration aditiva: coluna nova, nullable, sem backfill (todo registro já
-- existente fica com imei = null, que é exatamente "não informado" — nunca
-- exigido para nenhum produto, celular ou não).
--
-- `phones.model` é texto livre e cobre qualquer produto (não só celular,
-- desde a generalização "iPhone" -> "produto") — por isso o IMEI nunca é
-- obrigatório aqui: o sistema não tem como saber, só pelo schema, se uma
-- linha é de fato um celular. Quem vende celular preenche; quem vende
-- outra coisa deixa em branco.
alter table phones add column if not exists imei text;

-- Formato: exatamente 15 dígitos — mesma regra aplicada no formulário
-- (src/lib/imei.ts), repetida aqui como defesa em profundidade. Só valida
-- quando preenchido; nunca bloqueia um registro antigo com imei nulo.
alter table phones drop constraint if exists phones_imei_format_check;
alter table phones add constraint phones_imei_format_check
  check (imei is null or imei ~ '^[0-9]{15}$');

-- Unicidade por dono (nunca global): dois usuários diferentes deste app
-- são negócios diferentes e não devem ter o cadastro de um travado por um
-- IMEI que, por coincidência ou dado de teste, já existe no cadastro de
-- outro — mesmo princípio de isolamento por owner_id já usado em todo o
-- resto do sistema (RLS). Dentro do mesmo dono, nunca permite o mesmo IMEI
-- em dois aparelhos (índice parcial — nulos nunca colidem entre si).
create unique index if not exists phones_imei_owner_unique_idx
  on phones (owner_id, imei)
  where imei is not null;
