-- Corrige uma inconsistência real no cálculo de pagamento parcial de parcela
-- atrasada: o sistema não tinha nenhum campo para registrar quanto do juros
-- de atraso de uma parcela específica já foi efetivamente pago. Isso fazia
-- o valor pago "sumir" do juros pendente (ele continuava sendo cobrado de
-- novo, já que `calculateLateInterest` é recalculado ao vivo a partir de
-- due_date/hoje, sem nenhuma memória do que já foi recebido).
--
-- Espelha exatamente o padrão já usado para o principal (`paid_principal_amount`,
-- migration 0004). Migration aditiva: nenhuma coluna/tabela existente é
-- alterada ou removida; linhas já existentes recebem 0 (nenhum juros de
-- atraso registrado retroativamente).

alter table installments
  add column if not exists paid_interest_amount numeric(12, 2) not null default 0;

alter table installments
  add constraint installments_paid_interest_amount_check
    check (paid_interest_amount >= 0);
