-- ============================================================
-- Configuração de WhatsApp ativa POR USUÁRIO
--
-- O índice da 0001 garantia "no máximo uma configuração ativa" no banco
-- inteiro. Depois do isolamento por usuário (0015), isso impedia um
-- segundo usuário de salvar a própria configuração: o RLS esconde a linha
-- ativa do outro, a desativação não a alcança e o insert seguinte falha
-- com violação de unicidade. A regra correta é uma ativa por dono.
-- ============================================================
drop index if exists message_settings_single_active_idx;

create unique index if not exists message_settings_single_active_per_owner_idx
  on message_settings (owner_id)
  where is_active;
