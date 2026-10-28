-- Suporte ao provedor oficial "Meta Cloud API" (WhatsApp Business Platform),
-- em complemento ao Evolution API/Z-API/Twilio/WPPConnect já existentes.
--
-- Diferente dos provedores não-oficiais, a Cloud API da Meta exige que
-- mensagens iniciadas pela empresa (fora da janela de 24h de atendimento)
-- usem um template pré-aprovado pela Meta, com variáveis posicionais
-- ({{1}}, {{2}}, ...) em vez de texto livre. `template_name` e
-- `template_language` guardam qual template aprovado usar.

alter table message_settings drop constraint if exists message_settings_provider_check;
alter table message_settings
  add constraint message_settings_provider_check
  check (provider in ('evolution', 'zapi', 'twilio', 'wppconnect', 'meta'));

alter table message_settings add column if not exists template_name text;
alter table message_settings add column if not exists template_language text default 'pt_BR';
