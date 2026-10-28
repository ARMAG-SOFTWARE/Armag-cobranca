export type ContractType = "emprestimo" | "venda_iphone";

export type Periodicity = "diaria" | "semanal" | "quinzenal" | "mensal";

export type ContractStatus = "ativo" | "inadimplente" | "quitado" | "cancelado";

export type InstallmentStatus = "pendente" | "pago" | "parcial" | "atrasado";

export type WhatsAppProviderName = "evolution" | "zapi" | "twilio" | "wppconnect" | "meta";

export type WeeklyChargeStatus = "PENDENTE" | "PAGO" | "CANCELADO";

export type PaymentMethod = "dinheiro" | "pix" | "cartao" | "outro";

export type PhoneStatus = "estoque" | "vendido";

export interface Client {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  name: string;
  phone: string;
  /** Não é mais exibido na tela (Fase 1) — mantido no banco por compatibilidade com dados existentes. */
  email: string | null;
  street: string | null;
  street_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  /** Caminho do objeto no bucket privado `client-documents` (nunca uma URL pública). */
  document_photo_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  client_id: string;
  type: ContractType;
  description: string | null;
  /** Valor final financiado (já com o juros contratual aplicado) — o que é dividido em parcelas. */
  total_amount: number;
  /** Valor original do produto/empréstimo, antes do juros contratual. */
  principal_amount: number;
  has_down_payment: boolean;
  /** Valor da entrada (só relevante quando type = "venda_iphone"). Recebido à vista, fora das parcelas. */
  down_payment_amount: number;
  installments_count: number;
  periodicity: Periodicity;
  first_due_date: string;
  status: ContractStatus;
  /**
   * Taxa de juros contratual (%), escolhida manualmente no cadastro.
   * Empréstimo: por SEMANA (sugestão de 7,5%). Venda de produto: fixa sobre
   * o valor financiado (sugestão de 20%). Ver `calculateFinancedAmount`.
   */
  interest_rate_percent: number;
  /**
   * Juros de atraso (% ao dia sobre principal_amount), copiado de
   * Configurações no cadastro — mudar a configuração não altera contratos
   * já existentes.
   */
  late_interest_rate_percent_per_day: number;
  /**
   * Data em que o dinheiro emprestado realmente saiu da conta — editada
   * manualmente pelo usuário. null = "ainda vai sair" (não debita o saldo
   * geral de caixa ainda); preenchida = debita o `principal_amount` do
   * saldo geral nessa data. Só relevante para type = "emprestimo" — venda
   * de iPhone tem o custo de aquisição rastreado à parte, em `Phone`.
   */
  disbursed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Installment {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  contract_id: string;
  number: number;
  amount: number;
  due_date: string;
  status: InstallmentStatus;
  /** Soma do principal já pago desta parcela (permite pagamento parcial). */
  paid_principal_amount: number;
  /**
   * Soma do juros de atraso já efetivamente pago desta parcela. Necessário
   * para o juros pendente (`calculateLateInterest`) nunca voltar a cobrar
   * algo que o cliente já pagou — sem este campo, um pagamento parcial que
   * incluísse juros "desaparecia": o juros continuava sendo recalculado do
   * zero a cada consulta, como se nada tivesse sido pago.
   */
  paid_interest_amount: number;
  paid_at: string | null;
  reminder_sent_at: string | null;
  reminder_count: number;
  created_at: string;
  updated_at: string;
}

/** Um pagamento registrado contra uma parcela (histórico completo, item 16). */
export interface Payment {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  /** null representa a entrada (down payment) de um contrato de venda de iPhone. */
  installment_id: string | null;
  contract_id: string;
  client_id: string;
  principal_amount: number;
  interest_amount: number;
  method: PaymentMethod;
  paid_at: string;
  notes: string | null;
  /** E-mail do usuário autenticado que registrou o pagamento, se houver. */
  created_by_email: string | null;
  created_at: string;
  /**
   * true quando este registro representa uma quitação total (acordo),
   * nunca uma parcela normal nem uma entrada. `installment_id` é sempre
   * null nesse caso — o valor fecha o saldo de VÁRIAS parcelas de uma vez,
   * não uma específica.
   */
  is_settlement: boolean;
  /**
   * Saldo devedor do contrato (principal + juros de atraso) no instante da
   * quitação, só preenchido quando `is_settlement` — permite calcular a
   * diferença do acordo (saldo anterior − valor recebido) na exibição, sem
   * precisar de mais uma coluna para isso.
   */
  settlement_previous_balance: number | null;
}

/**
 * Detalhes do iPhone de uma venda (operação individual, sem conceito de
 * estoque — cada venda tem seu próprio aparelho, cadastrado junto com o
 * contrato). Rastreia custo de aquisição, venda e lucro separadamente dos
 * juros do empréstimo — lucro = sale_amount − cost_amount, sempre vinculado
 * a um contrato de "Venda de iPhone" (contract_id).
 */
export interface Phone {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  model: string;
  color: string | null;
  /**
   * IMEI do aparelho (exatamente 15 dígitos, sempre texto — nunca número,
   * pra nunca perder zero à esquerda). Opcional: nunca exigido para
   * produtos que não sejam celulares, e pode ser preenchido depois da
   * venda. Nunca apagado por nenhuma atualização de estoque/venda.
   */
  imei: string | null;
  /** Saúde da bateria em %, de 0 a 100. */
  battery_percent: number | null;
  description: string | null;
  cost_amount: number;
  status: PhoneStatus;
  acquired_at: string;
  sale_amount: number | null;
  sale_method: PaymentMethod | null;
  sold_at: string | null;
  buyer_name: string | null;
  contract_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Saída manual (combustível, celular, manutenção, despesa pessoal, etc). */
export interface Expense {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  description: string;
  category: string | null;
  amount: number;
  method: PaymentMethod;
  expense_date: string;
  notes: string | null;
  /** E-mail do usuário autenticado que registrou a saída, se houver. */
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageSettings {
  id: string;
  /** Dono do registro (auth.users.id) — cada usuário tem sua própria configuração de WhatsApp. */
  owner_id: string;
  provider: WhatsAppProviderName;
  base_url: string | null;
  api_key: string | null;
  instance_id: string | null;
  sender_number: string | null;
  auth_token: string | null;
  message_template: string;
  /** Nome do template aprovado pela Meta (obrigatório apenas para provider "meta"). */
  template_name: string | null;
  /** Código de idioma do template aprovado (ex: "pt_BR"). Só usado por provider "meta". */
  template_language: string | null;
  is_active: boolean;
  /** Telefone (com DDI/DDD) para receber alertas de sistema via WhatsApp — hoje, só falha de backup. Opcional. */
  admin_alert_phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Agendamento de disparo semanal de cobrança via WhatsApp para contratos
 * com periodicity 'semanal'. O status é sincronizado automaticamente a
 * partir do status do contrato (pagamento continua sendo controlado
 * manualmente pelos toggles de parcela) e é revalidado em tempo real
 * imediatamente antes de qualquer envio.
 */
export interface WeeklyCharge {
  id: string;
  /** Dono do registro (auth.users.id) — isolamento entre usuários via RLS. */
  owner_id: string;
  contract_id: string;
  client_id: string;
  status: WeeklyChargeStatus;
  dia_semana_disparo: number; // ISO 8601: 1=segunda ... 5=sexta
  proximo_disparo: string;
  last_dispatch_at: string | null;
  dispatch_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageLog {
  id: string;
  installment_id: string;
  client_id: string;
  status: "sent" | "failed";
  provider_response: unknown;
  sent_at: string;
}

export type BackupRunStatus = "running" | "success" | "failed";

/**
 * Uma execução do backup automático (a cada 6h, via GitHub Actions —
 * ver scripts/backup/). Nunca contém a chave de criptografia, a connection
 * string do banco nem credenciais do armazenamento externo — só metadados
 * seguros para exibir numa tela de histórico.
 */
export interface BackupRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: BackupRunStatus;
  tiers: string[];
  size_bytes: number | null;
  duration_seconds: number | null;
  destination: string | null;
  checksum: string | null;
  validation: Record<string, boolean> | null;
  error_message: string | null;
  restore_tested: boolean;
  created_at: string;
}

export interface ClientWithContracts extends Client {
  contracts: Contract[];
}

export interface ContractWithClient extends Contract {
  client: Client;
}

export interface ContractWithInstallments extends ContractWithClient {
  installments: Installment[];
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  emprestimo: "Empréstimo",
  venda_iphone: "Venda de Produto",
};

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  quitado: "Quitado",
  cancelado: "Cancelado",
};

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  parcial: "Parcial",
  atrasado: "Atrasado",
};

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsAppProviderName, string> = {
  evolution: "Evolution API",
  zapi: "Z-API",
  twilio: "Twilio",
  wppconnect: "WPPConnect",
  meta: "Meta Cloud API (oficial)",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao: "Cartão",
  outro: "Outro",
};

export const PHONE_STATUS_LABELS: Record<PhoneStatus, string> = {
  estoque: "Em estoque",
  vendido: "Vendido",
};

/** Como o botão de cobrança abre o WhatsApp. */
export type WhatsAppOpenMode = "padrao" | "business_android" | "web";

/** Configurações gerais do negócio (uma linha por usuário). */
export interface BusinessSettings {
  owner_id: string;
  /** Padrão copiado para cada contrato novo (% ao dia). */
  late_interest_rate_percent_per_day: number;
  whatsapp_open_mode: WhatsAppOpenMode;
  /** Número do WhatsApp Business da empresa — só exibido como lembrete junto ao botão. */
  business_whatsapp_number: string | null;
  created_at: string;
  updated_at: string;
}
