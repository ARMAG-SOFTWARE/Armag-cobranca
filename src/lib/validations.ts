import { z } from "zod";

import { IMEI_PATTERN } from "@/lib/imei";

export const transactionSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    clientName: z.string().trim().min(2, "Informe o nome do cliente."),
    clientPhone: z.string().trim().min(10, "Informe um telefone/WhatsApp válido."),
    clientEmail: z.string().trim().email().optional().or(z.literal("")),
    type: z.enum(["emprestimo", "venda_iphone"]),
    description: z.string().trim().optional().or(z.literal("")),
    /** Valor original do produto/empréstimo, antes do markup de 30% (aplicado no backend). */
    totalAmount: z.number({ error: "Informe o valor total." }).positive("O valor total deve ser maior que zero."),
    installmentsCount: z
      .number({ error: "Informe a quantidade de parcelas." })
      .int()
      .min(1, "Mínimo de 1 parcela.")
      .max(60, "Máximo de 60 parcelas."),
    periodicity: z.enum(["semanal", "quinzenal", "mensal"]),
    firstDueDate: z.string().min(10, "Informe a data do primeiro vencimento."),
    /** Só relevante/obrigatório para empréstimo — venda_iphone nunca tem juros automático. */
    interestRatePercent: z
      .number({ error: "Informe a taxa de juros." })
      .min(0, "A taxa não pode ser negativa.")
      .max(1000, "Taxa muito alta — confira o valor digitado.")
      .optional(),
    /**
     * Data em que o dinheiro emprestado já saiu da conta (vazio = ainda vai
     * sair). Só relevante para empréstimo.
     */
    disbursedAt: z.string().trim().optional().or(z.literal("")),
    /** Só relevante para venda_iphone. */
    hasDownPayment: z.boolean(),
    downPaymentAmount: z.number().min(0, "A entrada não pode ser negativa."),
    downPaymentMethod: z.enum(["dinheiro", "pix", "cartao", "outro"]),
    /**
     * Detalhes do aparelho — só relevantes/obrigatórios para venda_iphone.
     * Cada venda é uma operação individual (sem conceito de estoque):
     * o iPhone é cadastrado junto com a própria venda.
     */
    phoneModel: z.string().trim().optional().or(z.literal("")),
    phoneColor: z.string().trim().optional().or(z.literal("")),
    phoneBatteryPercent: z.number().min(0, "Mínimo 0%.").max(100, "Máximo 100%.").optional(),
    /** Custo de aquisição do iPhone (o que foi pago para adquiri-lo) — nunca confundir com o valor da venda. */
    phoneCostAmount: z.number().min(0, "O custo não pode ser negativo.").optional(),
    /**
     * IMEI do aparelho — sempre opcional (o sistema não distingue "celular"
     * de outro tipo de produto além do texto livre de `phoneModel`, então
     * nunca é exigido) e pode ser preenchido depois, na edição da venda.
     */
    phoneImei: z.string().trim().optional().or(z.literal("")),
  })
  .refine((data) => data.type === "venda_iphone" || !data.hasDownPayment, {
    message: "Entrada só se aplica a venda de produto.",
    path: ["hasDownPayment"],
  })
  .refine((data) => !data.hasDownPayment || data.downPaymentAmount > 0, {
    message: "Informe o valor da entrada.",
    path: ["downPaymentAmount"],
  })
  .refine((data) => !data.hasDownPayment || data.downPaymentAmount < data.totalAmount, {
    message: "A entrada deve ser menor que o valor total do produto.",
    path: ["downPaymentAmount"],
  })
  .refine((data) => data.type !== "emprestimo" || data.interestRatePercent !== undefined, {
    message: "Informe a taxa de juros.",
    path: ["interestRatePercent"],
  })
  .refine((data) => data.type !== "venda_iphone" || (data.phoneModel && data.phoneModel.length > 0), {
    message: "Informe o nome do produto.",
    path: ["phoneModel"],
  })
  .refine((data) => data.type !== "venda_iphone" || data.phoneCostAmount !== undefined, {
    message: "Informe o custo do produto.",
    path: ["phoneCostAmount"],
  })
  .refine((data) => !data.phoneImei || IMEI_PATTERN.test(data.phoneImei), {
    message: "IMEI deve conter exatamente 15 dígitos numéricos.",
    path: ["phoneImei"],
  });

export type TransactionInput = z.infer<typeof transactionSchema>;

export const paymentSchema = z
  .object({
    installmentId: z.string().uuid(),
    /**
     * Quando true, o servidor ignora `amount` e quita exatamente o que está
     * em aberto no momento da confirmação (principal + juros de atraso
     * recalculados na hora) — nunca um valor pré-calculado na tela, que pode
     * ficar desatualizado entre abrir o diálogo e confirmar o pagamento
     * (a causa raiz do saldo residual tipo "R$ 0,11").
     */
    payInFull: z.boolean(),
    amount: z.number().positive("O valor pago deve ser maior que zero.").optional(),
    method: z.enum(["dinheiro", "pix", "cartao", "outro"]),
    notes: z.string().trim().optional().or(z.literal("")),
    /** Gerado uma vez por tentativa de pagamento no cliente — protege contra clique duplo/reenvio. */
    idempotencyKey: z.string().uuid().optional(),
  })
  .refine((data) => data.payInFull || data.amount !== undefined, {
    message: "Informe o valor pago.",
    path: ["amount"],
  });

export type PaymentInput = z.infer<typeof paymentSchema>;

export const expenseSchema = z.object({
  description: z.string().trim().min(2, "Informe uma descrição."),
  category: z.string().trim().optional().or(z.literal("")),
  amount: z.number({ error: "Informe o valor." }).positive("O valor deve ser maior que zero."),
  method: z.enum(["dinheiro", "pix", "cartao", "outro"]),
  expenseDate: z.string().min(10, "Informe a data."),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

/**
 * Edição de uma venda de iPhone já cadastrada (item 21 do pedido): modelo,
 * cor, bateria e custo sempre editáveis (não afetam parcelas já geradas).
 * `saleAmount` só é aceito pelo backend quando o contrato ainda não tem
 * nenhum pagamento registrado — ver `updateIphoneSale`.
 */
export const iphoneSaleUpdateSchema = z
  .object({
    model: z.string().trim().min(1, "Informe o nome do produto."),
    color: z.string().trim().optional().or(z.literal("")),
    batteryPercent: z.number().min(0, "Mínimo 0%.").max(100, "Máximo 100%.").optional(),
    costAmount: z.number({ error: "Informe o custo do produto." }).min(0, "O custo não pode ser negativo."),
    saleAmount: z.number({ error: "Informe o valor da venda." }).positive("O valor da venda deve ser maior que zero."),
    /** Sempre opcional — pode ser cadastrado só depois da venda, se necessário. */
    imei: z.string().trim().optional().or(z.literal("")),
  })
  .refine((data) => !data.imei || IMEI_PATTERN.test(data.imei), {
    message: "IMEI deve conter exatamente 15 dígitos numéricos.",
    path: ["imei"],
  });

export type IphoneSaleUpdateInput = z.infer<typeof iphoneSaleUpdateSchema>;

/**
 * Edita a data em que o dinheiro de um empréstimo já cadastrado saiu de
 * fato da conta (item do fluxo de caixa pedido pelo cliente). Vazio/undefined
 * marca como "ainda vai sair" (volta a não debitar o saldo geral).
 */
export const contractDisbursementSchema = z.object({
  disbursedAt: z.string().trim().optional().or(z.literal("")),
});

export type ContractDisbursementInput = z.infer<typeof contractDisbursementSchema>;

export const messageSettingsSchema = z.object({
  provider: z.enum(["evolution", "zapi", "twilio", "wppconnect", "meta"]),
  baseUrl: z.string().trim().optional().or(z.literal("")),
  apiKey: z.string().trim().optional().or(z.literal("")),
  instanceId: z.string().trim().optional().or(z.literal("")),
  senderNumber: z.string().trim().optional().or(z.literal("")),
  authToken: z.string().trim().optional().or(z.literal("")),
  messageTemplate: z.string().trim().min(10, "O template não pode ficar vazio."),
  templateName: z.string().trim().optional().or(z.literal("")),
  templateLanguage: z.string().trim().optional().or(z.literal("")),
  /** Recebe alerta via WhatsApp quando o backup automático falhar. Opcional. */
  adminAlertPhone: z.string().trim().optional().or(z.literal("")),
});

export type MessageSettingsInput = z.infer<typeof messageSettingsSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const clientInfoSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente."),
  phone: z.string().trim().min(10, "Informe um telefone/WhatsApp válido."),
  email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type ClientInfoInput = z.infer<typeof clientInfoSchema>;

export const clientAddressSchema = z.object({
  street: z.string().trim().optional().or(z.literal("")),
  streetNumber: z.string().trim().optional().or(z.literal("")),
  neighborhood: z.string().trim().optional().or(z.literal("")),
  city: z.string().trim().optional().or(z.literal("")),
  state: z.string().trim().max(2, "Use a sigla do estado (ex: SP).").optional().or(z.literal("")),
  zipCode: z.string().trim().optional().or(z.literal("")),
});

export type ClientAddressInput = z.infer<typeof clientAddressSchema>;

/**
 * Quitação total de uma dívida (contrato) por um valor possivelmente
 * diferente do saldo devedor atual (acordo) — ver `settleContract` em
 * actions.ts para a regra completa. O saldo devedor em si nunca vem do
 * cliente: é sempre recalculado no servidor no momento da confirmação.
 */
export const settleContractSchema = z.object({
  amountReceived: z
    .number({ error: "Informe o valor recebido." })
    .positive("O valor recebido deve ser maior que zero."),
  notes: z.string().trim().max(500, "Observação muito longa.").optional().or(z.literal("")),
  /** Gerado uma vez por tentativa no cliente — protege contra clique duplo/reenvio. */
  idempotencyKey: z.string().uuid().optional(),
});

export type SettleContractInput = z.infer<typeof settleContractSchema>;
