"use server";

import { revalidatePath } from "next/cache";
import { getISODay, parseISO } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit-log";
import { getBusinessToday } from "@/lib/date-utils";
import { detectSafeDocumentType } from "@/lib/file-validation";
import { generateInstallments, nextDueDate, reflowSchedule } from "@/lib/installments";
import { normalizeImei } from "@/lib/imei";
import { sendCollectionReminder } from "@/lib/whatsapp";
import {
  allocateSettlement,
  calculateFinancedAmount,
  calculateLateInterest,
  DEFAULT_LATE_INTEREST_RATE_PERCENT_PER_DAY,
  PRODUCT_SALE_MAX_WEEKS,
  daysLate,
  roundCents,
  splitPayment,
  type SettlementInstallmentInput,
} from "@/lib/financial-rules";
import {
  businessSettingsSchema,
  messageSettingsSchema,
  transactionSchema,
  paymentSchema,
  expenseSchema,
  iphoneSaleUpdateSchema,
  clientAddressSchema,
  clientInfoSchema,
  contractDisbursementSchema,
  settleContractSchema,
  contractPeriodicitySchema,
  renewInstallmentSchema,
  type TransactionInput,
  type MessageSettingsInput,
  type PaymentInput,
  type ExpenseInput,
  type IphoneSaleUpdateInput,
  type ClientAddressInput,
  type ClientInfoInput,
  type ContractDisbursementInput,
  type SettleContractInput,
  type BusinessSettingsInput,
  type ContractPeriodicityInput,
  type RenewInstallmentInput,
} from "@/lib/validations";
import type { ContractStatus, ContractType, InstallmentStatus, Periodicity, WeeklyChargeStatus } from "@/lib/types";
import { formatCurrency, onlyDigits } from "@/lib/utils";

/**
 * E-mail do usuário autenticado, só para preencher `created_by_email`
 * (rótulo de auditoria — quem registrou o quê). Usa `getSession()` em vez
 * de `getUser()` de propósito: `getSession()` lê a sessão já decodificada
 * dos cookies, sem round-trip de rede até o servidor de Auth do Supabase;
 * `getUser()` sempre revalida o token contra o Auth (uma requisição extra,
 * tipicamente mais lenta que a própria query no banco). Isso é seguro aqui
 * porque esta função NUNCA é usada para autorizar nada — quem decide se a
 * operação pode acontecer é sempre o RLS do Postgres — e o proxy.ts já
 * validou a sessão com `getUser()` uma vez no início desta mesma requisição.
 */
async function getCurrentUserEmail(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.email ?? null;
}

/**
 * Id do usuário autenticado (auth.users.id) — preenche `owner_id` em todo
 * registro novo (cliente, contrato, parcela, pagamento, despesa, venda de
 * iPhone, configuração de WhatsApp, disparo semanal), a coluna que o RLS
 * usa para isolar os dados de cada usuário dos demais. Mesma justificativa
 * de `getCurrentUserEmail` para usar `getSession()` em vez de `getUser()` —
 * nunca é usada para autorizar nada, só para rotular de quem é o registro;
 * quem efetivamente barra o acesso é sempre o RLS do Postgres (então mesmo
 * que esta função retornasse errado, não haveria vazamento de dado — o
 * INSERT seria rejeitado pelo `with check (owner_id = auth.uid())`).
 */
async function getCurrentUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/**
 * Nunca repassa a mensagem crua de um erro do Postgres/Supabase para o
 * navegador — pode revelar nomes de tabela, coluna, constraint ou outro
 * detalhe interno do schema. O usuário sempre recebe uma mensagem genérica
 * e segura; o detalhe técnico vai só para o log do servidor (visível nos
 * logs da Vercel/Supabase, nunca na resposta da API).
 */
function safeError(error: { message: string } | null | undefined, fallback: string): string {
  if (error) {
    console.error(`[actions] ${fallback} —`, error.message);
  }
  return fallback;
}

/** ISO 8601 (1=segunda ... 7=domingo), com fins de semana ajustados para o dia útil mais próximo. */
function toBusinessWeekday(date: string): number {
  const isoWeekday = getISODay(parseISO(date));
  if (isoWeekday === 6) return 5; // sábado -> sexta
  if (isoWeekday === 7) return 1; // domingo -> segunda
  return isoWeekday;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  contractId?: string;
}

export async function createTransaction(input: TransactionInput): Promise<ActionResult> {
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  let clientId = data.clientId;

  if (!clientId) {
    // A busca por telefone já é implicitamente restrita ao próprio usuário
    // pelo RLS — nunca reaproveita (nem enxerga) um cliente de outro dono
    // com o mesmo telefone.
    const phoneDigits = onlyDigits(data.clientPhone);
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("phone", phoneDigits)
      .maybeSingle();

    if (existing) {
      clientId = existing.id;
    } else {
      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({
          owner_id: ownerId,
          name: data.clientName,
          phone: phoneDigits,
          email: data.clientEmail || null,
        })
        .select("id")
        .single();

      if (clientError || !newClient) {
        return { ok: false, error: safeError(clientError, "Erro ao criar cliente.") };
      }
      clientId = newClient.id;
    }
  }

  const hasDownPayment = data.type === "venda_iphone" && data.hasDownPayment;
  // Empréstimo: % por semana; venda de produto: % fixo (obrigatório para
  // os dois tipos, garantido pelo refine do schema).
  const interestRatePercent = data.interestRatePercent!;
  const { totalFinanced } = calculateFinancedAmount({
    contractType: data.type,
    principalAmount: data.totalAmount,
    installmentsCount: data.installmentsCount,
    periodicity: data.periodicity,
    hasDownPayment,
    downPaymentAmount: data.downPaymentAmount,
    interestRatePercent,
  });
  // Juros de atraso: copia a taxa atual de Configurações para o contrato —
  // mudar a configuração depois nunca altera este contrato.
  const { data: businessSettings } = await supabase
    .from("business_settings")
    .select("late_interest_rate_percent_per_day")
    .eq("owner_id", ownerId)
    .maybeSingle();
  const lateInterestRatePercentPerDay =
    businessSettings?.late_interest_rate_percent_per_day ?? DEFAULT_LATE_INTEREST_RATE_PERCENT_PER_DAY;
  // "Ainda vai sair" (campo em branco) fica como null — não debita o saldo
  // geral de caixa até o usuário confirmar a data real da saída, editando
  // depois na tela do contrato.
  const disbursedAt = data.type === "emprestimo" && data.disbursedAt ? data.disbursedAt : null;

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .insert({
      owner_id: ownerId,
      client_id: clientId,
      type: data.type,
      description: data.description || null,
      principal_amount: data.totalAmount,
      has_down_payment: hasDownPayment,
      down_payment_amount: hasDownPayment ? data.downPaymentAmount : 0,
      // total_amount já sai com os juros aplicados quando for empréstimo
      // (taxa manual escolhida no formulário) ou exatamente o valor digitado
      // quando for venda de iPhone (sem juros automático) — é isto que é
      // dividido em parcelas. O juros nunca é recalculado por parcela.
      total_amount: totalFinanced,
      installments_count: data.installmentsCount,
      periodicity: data.periodicity,
      first_due_date: data.firstDueDate,
      status: "ativo",
      interest_rate_percent: interestRatePercent,
      late_interest_rate_percent_per_day: lateInterestRatePercentPerDay,
      disbursed_at: disbursedAt,
    })
    .select("id")
    .single();

  if (contractError || !contract) {
    return { ok: false, error: safeError(contractError, "Erro ao criar contrato.") };
  }

  const installments = generateInstallments({
    totalAmount: totalFinanced,
    installmentsCount: data.installmentsCount,
    periodicity: data.periodicity,
    firstDueDate: data.firstDueDate,
  }).map((installment) => ({
    owner_id: ownerId,
    contract_id: contract.id,
    number: installment.number,
    amount: installment.amount,
    due_date: installment.due_date,
  }));

  const createdByEmail = hasDownPayment && data.downPaymentAmount > 0 ? await getCurrentUserEmail(supabase) : null;

  // As quatro gravações abaixo (parcelas, entrada, aparelho, disparo
  // semanal) só dependem do contrato já criado — nenhuma lê o resultado
  // das outras —, então rodam em paralelo em vez de uma esperar a
  // anterior. A ordem de checagem dos erros abaixo é a mesma prioridade
  // que o código sequencial anterior usava, então o erro reportado ao
  // usuário quando algo dá errado continua sendo o mesmo.
  const [installmentsResult, downPaymentResult, phoneResult, weeklyChargeResult] = await Promise.all([
    supabase.from("installments").insert(installments),
    hasDownPayment && data.downPaymentAmount > 0
      ? supabase.from("payments").insert({
          owner_id: ownerId,
          installment_id: null,
          contract_id: contract.id,
          client_id: clientId,
          principal_amount: roundCents(data.downPaymentAmount),
          interest_amount: 0,
          method: data.downPaymentMethod,
          notes: "Entrada",
          created_by_email: createdByEmail,
        })
      : Promise.resolve({ error: null }),
    // Venda de iPhone é uma operação individual (sem estoque): o aparelho é
    // cadastrado junto com a própria venda, já vinculado ao contrato. O
    // lucro (venda − custo) é sempre calculado sob demanda a partir daqui,
    // nunca dependente de quanto o cliente já pagou.
    data.type === "venda_iphone"
      ? supabase.from("phones").insert({
          owner_id: ownerId,
          model: data.phoneModel,
          color: data.phoneColor || null,
          battery_percent: data.phoneBatteryPercent ?? null,
          cost_amount: roundCents(data.phoneCostAmount ?? 0),
          status: "vendido",
          sale_amount: roundCents(data.totalAmount),
          sold_at: new Date().toISOString(),
          acquired_at: getBusinessToday(),
          contract_id: contract.id,
          imei: data.phoneImei ? normalizeImei(data.phoneImei) : null,
        })
      : Promise.resolve({ error: null }),
    data.periodicity === "semanal"
      ? supabase.from("weekly_charges").insert({
          owner_id: ownerId,
          contract_id: contract.id,
          client_id: clientId,
          dia_semana_disparo: toBusinessWeekday(data.firstDueDate),
          proximo_disparo: data.firstDueDate,
          status: "PENDENTE",
        })
      : Promise.resolve({ error: null }),
  ]);

  if (installmentsResult.error) {
    return { ok: false, error: safeError(installmentsResult.error, "Erro ao gerar parcelas.") };
  }
  if (downPaymentResult.error) {
    return { ok: false, error: safeError(downPaymentResult.error, "Erro ao registrar a entrada.") };
  }
  if (phoneResult.error) {
    if (phoneResult.error.code === "23505" && phoneResult.error.message?.includes("imei")) {
      return { ok: false, error: "Este IMEI já está cadastrado em outro aparelho." };
    }
    return { ok: false, error: safeError(phoneResult.error, "Erro ao cadastrar o produto.") };
  }
  if (weeklyChargeResult.error) {
    return { ok: false, error: safeError(weeklyChargeResult.error, "Erro ao agendar cobrança semanal.") };
  }

  revalidatePath("/");
  revalidatePath("/clientes");
  if (data.type === "venda_iphone") {
    revalidatePath("/phones");
  }
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId,
    action: data.type === "venda_iphone" ? "iphone_sale_created" : "loan_created",
    resourceType: "contract",
    resourceId: contract.id,
    metadata: { totalAmount: data.totalAmount, installmentsCount: data.installmentsCount },
  });
  return { ok: true, contractId: contract.id };
}

/**
 * Mantém `weekly_charges.status` sincronizado com o status do contrato.
 * O pagamento continua sendo controlado manualmente pelos toggles de
 * parcela — isto apenas reflete esse controle no campo que a fila de
 * disparo semanal checa em tempo real antes de cada envio.
 */
async function syncWeeklyChargeStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  contractStatus: ContractStatus,
) {
  let weeklyStatus: WeeklyChargeStatus = "PENDENTE";
  if (contractStatus === "quitado") weeklyStatus = "PAGO";
  else if (contractStatus === "cancelado") weeklyStatus = "CANCELADO";

  await supabase.from("weekly_charges").update({ status: weeklyStatus }).eq("contract_id", contractId);
}

async function recalculateContractStatus(supabase: Awaited<ReturnType<typeof createClient>>, contractId: string) {
  // "Cancelado" é um estado terminal e manual (deleteContract) — nunca
  // recalculado a partir das parcelas. Sem esta checagem, um pagamento
  // registrado por engano num contrato já cancelado (a página do
  // contrato continua acessível e os botões continuam ativos) fazia o
  // contrato "reaparecer" como ativo/inadimplente/quitado, voltando a
  // contar em qualquer lista/indicador de onde tinha sido
  // intencionalmente removido.
  const { data: currentContract } = await supabase.from("contracts").select("status").eq("id", contractId).single();
  if (currentContract?.status === "cancelado") return;

  const { data: installments } = await supabase
    .from("installments")
    .select("status")
    .eq("contract_id", contractId);

  if (!installments || installments.length === 0) return;

  let status: ContractStatus = "ativo";
  if (installments.every((installment) => installment.status === "pago")) {
    status = "quitado";
  } else if (installments.some((installment) => installment.status === "atrasado")) {
    status = "inadimplente";
  }

  // As duas atualizações são independentes entre si (nenhuma lê o
  // resultado da outra) — rodam em paralelo em vez de uma esperar a outra.
  await Promise.all([
    supabase.from("contracts").update({ status }).eq("id", contractId),
    syncWeeklyChargeStatus(supabase, contractId, status),
  ]);
}

/**
 * Exclui um empréstimo/venda cadastrado errado. Duas situações:
 *
 * 1) Nenhum pagamento registrado ainda: exclusão real. O contrato é
 *    apagado (a foreign key `on delete cascade` já existente cuida de
 *    parcelas, weekly_charges e message_logs automaticamente — não sobra
 *    nada órfão); se for uma venda de iPhone, o registro do aparelho
 *    também é excluído (a venda nunca aconteceu de fato).
 * 2) Já existe pagamento registrado: NUNCA apaga silenciosamente o
 *    histórico financeiro. Em vez disso, o contrato é marcado como
 *    "cancelado" (status que já existe no sistema) — payments, installments
 *    e o histórico continuam intactos para auditoria, mas o contrato para
 *    de contar em qualquer indicador/pendência/Devedores do Dia.
 */
export async function deleteContract(contractId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .maybeSingle();

  if (contractError) {
    return { ok: false, error: safeError(contractError, "Erro ao buscar empréstimo.") };
  }
  if (!contract) {
    return { ok: false, error: "Empréstimo não encontrado (talvez já tenha sido excluído)." };
  }

  const { count: paymentsCount, error: countError } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);

  if (countError) {
    return { ok: false, error: safeError(countError, "Erro ao verificar pagamentos.") };
  }

  if ((paymentsCount ?? 0) > 0) {
    const { error: cancelError } = await supabase
      .from("contracts")
      .update({ status: "cancelado" })
      .eq("id", contractId);
    if (cancelError) {
      return { ok: false, error: safeError(cancelError, "Erro ao cancelar empréstimo.") };
    }
    await syncWeeklyChargeStatus(supabase, contractId, "cancelado");
    await logAudit(supabase, {
      actorEmail: await getCurrentUserEmail(supabase),
      ownerId,
      action: "contract_cancelled",
      resourceType: "contract",
      resourceId: contractId,
      metadata: { reason: "tinha pagamentos registrados — histórico preservado" },
    });

    revalidatePath("/");
  revalidatePath("/clientes");
    revalidatePath("/debtors");
    revalidatePath(`/contracts/${contractId}`);
    return { ok: true };
  }

  // Venda de iPhone é uma operação individual (sem estoque): se o contrato
  // excluído for uma venda sem nenhum pagamento, o registro do aparelho
  // não tem mais razão para existir — a venda nunca aconteceu de fato.
  const { error: phoneDeleteError } = await supabase.from("phones").delete().eq("contract_id", contractId);

  if (phoneDeleteError) {
    return { ok: false, error: safeError(phoneDeleteError, "Erro ao excluir produto vinculado.") };
  }

  const { error: deleteError } = await supabase.from("contracts").delete().eq("id", contractId);
  if (deleteError) {
    return { ok: false, error: safeError(deleteError, "Erro ao excluir empréstimo.") };
  }
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId,
    action: "contract_deleted",
    resourceType: "contract",
    resourceId: contractId,
    metadata: { reason: "sem pagamentos registrados" },
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  revalidatePath("/phones");
  return { ok: true };
}

export async function updateInstallmentStatus(
  installmentId: string,
  status: InstallmentStatus,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: installment, error } = await supabase
    .from("installments")
    .update({ status, paid_at: status === "pago" ? new Date().toISOString() : null })
    .eq("id", installmentId)
    .select("contract_id")
    .single();

  if (error || !installment) {
    return { ok: false, error: safeError(error, "Erro ao atualizar parcela.") };
  }

  await recalculateContractStatus(supabase, installment.contract_id);

  revalidatePath(`/contracts/${installment.contract_id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Fluxo principal de recebimento de uma parcela: calcula o juros de atraso
 * em aberto no momento (ao vivo, via calculateLateInterest — nunca um valor
 * acumulado salvo), aplica o valor pago primeiro no PRINCIPAL e só o que
 * sobrar no juros (ver `splitPayment` em financial-rules.ts, a regra real),
 * e registra tudo em `payments` para o histórico (item 16), suportando
 * pagamento parcial e qualquer forma de pagamento.
 */
export async function registerPayment(input: PaymentInput): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  // A checagem de idempotência (clique duplo/reenvio) e a busca da parcela
  // (já com o contrato embutido via join, numa única query em vez de duas)
  // não dependem uma da outra — disparadas em paralelo. A garantia real
  // contra duplicidade continua sendo o índice único de `idempotency_key`
  // no banco (ver o tratamento do erro 23505 mais abaixo); esta checagem
  // aqui só evita o round-trip extra de inserir e falhar no caso comum.
  type InstallmentWithContract = {
    id: string;
    contract_id: string;
    amount: number;
    paid_principal_amount: number;
    paid_interest_amount: number;
    due_date: string;
    status: InstallmentStatus;
    contract: {
      client_id: string;
      type: ContractType;
      principal_amount: number;
      late_interest_rate_percent_per_day: number;
      status: ContractStatus;
    } | null;
  };

  const [{ data: existingPayment }, { data: installmentData, error: installmentError }] = await Promise.all([
    data.idempotencyKey
      ? supabase.from("payments").select("contract_id").eq("idempotency_key", data.idempotencyKey).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("installments")
      .select(
        "id, contract_id, amount, paid_principal_amount, paid_interest_amount, due_date, status, contract:contracts(client_id, type, principal_amount, late_interest_rate_percent_per_day, status)",
      )
      .eq("id", data.installmentId)
      .single(),
  ]);
  const installment = installmentData as unknown as InstallmentWithContract | null;

  if (existingPayment) {
    return { ok: true, contractId: existingPayment.contract_id };
  }

  if (installmentError || !installment) {
    return { ok: false, error: safeError(installmentError, "Parcela não encontrada.") };
  }

  if (installment.status === "pago") {
    return { ok: false, error: "Esta parcela já está totalmente paga." };
  }

  const contract = installment.contract;
  if (!contract) {
    return { ok: false, error: "Contrato não encontrado." };
  }
  if (contract.status === "cancelado") {
    return { ok: false, error: "Este empréstimo/venda foi cancelado. Não é possível registrar pagamento nele." };
  }

  // Juros de atraso e saldo em aberto SEMPRE recalculados agora, no servidor
  // — nunca a partir de um valor mostrado na tela momentos atrás. Isso
  // fecha a causa raiz do saldo residual tipo "R$ 0,11": se o pagamento é
  // integral, o valor cobrado é exatamente o que está em aberto no instante
  // da confirmação, nunca um total pré-calculado que ficou desatualizado.
  // O juros de atraso usa o valor ORIGINALMENTE EMPRESTADO no contrato como
  // base (nunca o valor da parcela) e só existe para empréstimo — venda de
  // iPhone nunca gera juros de atraso. `paidInterestAmount` garante que
  // juros já pago nunca volte a ser cobrado (sem isso, um pagamento parcial
  // que incluísse juros "desaparecia" e era recalculado do zero na consulta
  // seguinte — a causa raiz do total R$590 em vez de R$520 num caso real).
  const interestOwed = calculateLateInterest({
    lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
    originalPrincipalAmount: contract.principal_amount,
    dueDate: installment.due_date,
    status: installment.status,
    paidInterestAmount: installment.paid_interest_amount,
  });
  const principalOwed = roundCents(Math.max(installment.amount - installment.paid_principal_amount, 0));

  const amountToApply = data.payInFull ? roundCents(interestOwed + principalOwed) : roundCents(data.amount!);

  const { interestPortion, principalPortion } = splitPayment(amountToApply, interestOwed, principalOwed);

  if (interestPortion + principalPortion <= 0) {
    return { ok: false, error: "Não há saldo em aberto nesta parcela." };
  }

  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }
  const createdByEmail = await getCurrentUserEmail(supabase);

  // Nunca deixa passar de `installment.amount` (mesmo por causa de ruído de
  // ponto flutuante): parcela quitada sempre fecha com saldo exatamente
  // zero e status "pago", nunca um resíduo de centavos.
  const newPaidPrincipal = Math.min(
    roundCents(installment.paid_principal_amount + principalPortion),
    roundCents(installment.amount),
  );
  // `principalPortion` só "vaza" para o juros (via splitPayment, que aplica
  // primeiro no principal) quando o principal já foi totalmente coberto
  // nesta mesma operação — por isso persistir o juros pago aqui nunca sobe
  // sem que o principal também tenha chegado ao total da parcela.
  const newPaidInterest = roundCents(installment.paid_interest_amount + interestPortion);
  const isFullyPaid = newPaidPrincipal >= roundCents(installment.amount);
  const isStillLate = daysLate(installment.due_date) > 0;

  const newStatus: InstallmentStatus = isFullyPaid ? "pago" : isStillLate ? "atrasado" : "parcial";
  const newPaidAt = isFullyPaid ? new Date().toISOString() : null;

  // Grava o pagamento e atualiza a parcela ATOMICAMENTE numa única chamada
  // (register_payment_atomic, migration 0018) — antes eram dois writes
  // sequenciais e independentes; uma falha entre eles podia deixar o
  // pagamento gravado sem a parcela refletir isso. A function também
  // trava a linha da parcela e confere que o estado lido acima
  // (`p_expected_*`) ainda é o atual antes de escrever — fecha a corrida
  // entre dois pagamentos concorrentes na mesma parcela.
  type RegisterPaymentRpcResult = { payment_id: string; already_existed: boolean };
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("register_payment_atomic", {
      p_installment_id: installment.id,
      p_owner_id: ownerId,
      p_contract_id: installment.contract_id,
      p_client_id: contract.client_id,
      p_principal_portion: principalPortion,
      p_interest_portion: interestPortion,
      p_method: data.method,
      p_notes: data.notes || null,
      p_created_by_email: createdByEmail,
      p_idempotency_key: data.idempotencyKey ?? null,
      p_expected_paid_principal: installment.paid_principal_amount,
      p_expected_paid_interest: installment.paid_interest_amount,
      p_expected_status: installment.status,
      p_new_paid_principal: newPaidPrincipal,
      p_new_paid_interest: newPaidInterest,
      p_new_status: newStatus,
      p_new_paid_at: newPaidAt,
    })
    .single();

  if (rpcError) {
    if (rpcError.message?.includes("installment_changed_concurrently")) {
      return {
        ok: false,
        error: "Esta parcela foi alterada por outro pagamento ao mesmo tempo. Atualize a tela e tente de novo.",
      };
    }
    // unique_violation: rede de segurança final, caso duas requisições com
    // a mesma idempotencyKey cheguem a ponto de colidir mesmo com a
    // checagem já feita dentro da function — trata como sucesso, nunca
    // como erro, e nunca duplica o pagamento.
    if (rpcError.code === "23505" && data.idempotencyKey) {
      return { ok: true, contractId: installment.contract_id };
    }
    return { ok: false, error: safeError(rpcError, "Erro ao registrar pagamento.") };
  }

  const rpcResult = rpcData as unknown as RegisterPaymentRpcResult | null;
  if (rpcResult?.already_existed) {
    return { ok: true, contractId: installment.contract_id };
  }

  await recalculateContractStatus(supabase, installment.contract_id);

  revalidatePath(`/contracts/${installment.contract_id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  if (contract.type === "venda_iphone") {
    revalidatePath("/phones");
  }
  await logAudit(supabase, {
    actorEmail: createdByEmail,
    ownerId,
    action: "payment_registered",
    resourceType: "installment",
    resourceId: installment.id,
    metadata: {
      principalAmount: principalPortion,
      interestAmount: interestPortion,
      method: data.method,
      newStatus,
    },
  });
  return { ok: true, contractId: installment.contract_id };
}

/**
 * Renovação de parcela: paga só o juros de atraso pendente agora e empurra
 * o vencimento 1 período (semanal/quinzenal/mensal, conforme o contrato)
 * para frente — o principal da parcela NUNCA é reduzido aqui, continua
 * integralmente em aberto até um pagamento normal de verdade (registerPayment).
 * Uso típico: empréstimo onde o cliente só paga o juros todo mês e "rola"
 * a dívida, até decidir quitar o principal.
 *
 * Só faz sentido para empréstimo (venda de produto nunca tem juros de
 * atraso) e só quando há juros de fato pendente agora — sem isso, não há o
 * que renovar. O juros é sempre recalculado ao vivo no servidor
 * (`calculateLateInterest`), nunca um valor vindo da tela.
 */
export async function renewInstallment(installmentId: string, input: RenewInstallmentInput): Promise<ActionResult> {
  const parsed = renewInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  type RenewInstallmentRow = {
    id: string;
    contract_id: string;
    due_date: string;
    status: InstallmentStatus;
    paid_principal_amount: number;
    paid_interest_amount: number;
    contract: {
      client_id: string;
      type: ContractType;
      status: ContractStatus;
      principal_amount: number;
      late_interest_rate_percent_per_day: number;
      periodicity: Periodicity;
    } | null;
  };

  const [{ data: existingPayment }, { data: installmentData, error: installmentError }] = await Promise.all([
    data.idempotencyKey
      ? supabase.from("payments").select("contract_id").eq("idempotency_key", data.idempotencyKey).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("installments")
      .select(
        "id, contract_id, due_date, status, paid_principal_amount, paid_interest_amount, contract:contracts(client_id, type, status, principal_amount, late_interest_rate_percent_per_day, periodicity)",
      )
      .eq("id", installmentId)
      .single(),
  ]);

  if (existingPayment) {
    return { ok: true, contractId: existingPayment.contract_id };
  }

  if (installmentError || !installmentData) {
    return { ok: false, error: safeError(installmentError, "Parcela não encontrada.") };
  }
  const installment = installmentData as unknown as RenewInstallmentRow;
  const contract = installment.contract;
  if (!contract) {
    return { ok: false, error: "Contrato não encontrado." };
  }
  if (contract.status === "cancelado") {
    return { ok: false, error: "Este empréstimo foi cancelado. Não é possível renovar parcela." };
  }
  if (installment.status === "pago") {
    return { ok: false, error: "Esta parcela já está totalmente paga." };
  }

  const interestOwed = calculateLateInterest({
    lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
    originalPrincipalAmount: contract.principal_amount,
    dueDate: installment.due_date,
    status: installment.status,
    paidInterestAmount: installment.paid_interest_amount,
  });
  if (interestOwed <= 0) {
    return { ok: false, error: "Esta parcela não tem juros de atraso pendente para renovar." };
  }

  const newDueDate = nextDueDate(installment.due_date, contract.periodicity);
  const newStatus: InstallmentStatus = daysLate(newDueDate) > 0 ? "atrasado" : "pendente";

  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }
  const createdByEmail = await getCurrentUserEmail(supabase);

  type RenewRpcResult = { payment_id: string; already_existed: boolean };
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("renew_installment_atomic", {
      p_installment_id: installment.id,
      p_owner_id: ownerId,
      p_contract_id: installment.contract_id,
      p_client_id: contract.client_id,
      p_interest_amount: interestOwed,
      p_new_due_date: newDueDate,
      p_new_status: newStatus,
      p_expected_paid_principal: installment.paid_principal_amount,
      p_expected_paid_interest: installment.paid_interest_amount,
      p_expected_status: installment.status,
      p_expected_due_date: installment.due_date,
      p_method: "outro",
      p_notes: data.notes || null,
      p_created_by_email: createdByEmail,
      p_idempotency_key: data.idempotencyKey ?? null,
    })
    .single();

  if (rpcError) {
    if (rpcError.message?.includes("installment_changed_concurrently")) {
      return {
        ok: false,
        error: "Esta parcela foi alterada enquanto a tela estava aberta. Atualize e tente de novo.",
      };
    }
    if (rpcError.code === "23505" && data.idempotencyKey) {
      return { ok: true, contractId: installment.contract_id };
    }
    return { ok: false, error: safeError(rpcError, "Erro ao renovar a parcela.") };
  }

  const rpcResult = rpcData as unknown as RenewRpcResult | null;
  if (rpcResult?.already_existed) {
    return { ok: true, contractId: installment.contract_id };
  }

  await recalculateContractStatus(supabase, installment.contract_id);

  revalidatePath(`/contracts/${installment.contract_id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");

  await logAudit(supabase, {
    actorEmail: createdByEmail,
    ownerId,
    action: "installment_renewed",
    resourceType: "installment",
    resourceId: installment.id,
    metadata: {
      interestAmount: interestOwed,
      previousDueDate: installment.due_date,
      newDueDate,
    },
  });

  return { ok: true, contractId: installment.contract_id };
}

export interface ContractSettlementSummary {
  clientName: string;
  contractLabel: string;
  /** contract.total_amount — valor original total do contrato, já com juros do empréstimo se houver. */
  originalAmount: number;
  /** Soma de tudo já pago neste contrato (entrada + parcelas), via `payments`. */
  totalPaid: number;
  /** Saldo devedor atual — soma do principal + juros de atraso pendente de TODAS as parcelas ainda não pagas. */
  outstandingBalance: number;
  canSettle: boolean;
  reasonCannotSettle?: string;
}

type SettlementContractRow = {
  id: string;
  owner_id: string;
  client_id: string;
  type: ContractType;
  status: ContractStatus;
  principal_amount: number;
  late_interest_rate_percent_per_day: number;
  client: { name: string } | null;
  installments: {
    id: string;
    number: number;
    amount: number;
    due_date: string;
    status: InstallmentStatus;
    paid_principal_amount: number;
    paid_interest_amount: number;
  }[];
};

function buildSettlementInstallmentInputs(
  contract: Pick<SettlementContractRow, "late_interest_rate_percent_per_day" | "principal_amount" | "installments">,
): { remaining: SettlementContractRow["installments"]; settlementInput: SettlementInstallmentInput[] } {
  const remaining = contract.installments.filter((installment) => installment.status !== "pago");
  const settlementInput: SettlementInstallmentInput[] = remaining.map((installment) => ({
    id: installment.id,
    number: installment.number,
    outstandingPrincipal: roundCents(Math.max(installment.amount - installment.paid_principal_amount, 0)),
    interestOwed: calculateLateInterest({
      lateInterestRatePercentPerDay: contract.late_interest_rate_percent_per_day,
      originalPrincipalAmount: contract.principal_amount,
      dueDate: installment.due_date,
      status: installment.status,
      paidInterestAmount: installment.paid_interest_amount,
    }),
  }));
  return { remaining, settlementInput };
}

/**
 * Prévia (somente leitura) da quitação total de um contrato — chamada
 * sempre que o diálogo "Quitar dívida" abre, para nunca mostrar um saldo
 * desatualizado (mesmo princípio de `registerPayment`: o número exato é
 * sempre recalculado agora, nunca um valor guardado há algum tempo na tela).
 */
export async function getContractSettlementSummary(
  contractId: string,
): Promise<{ ok: true; summary: ContractSettlementSummary } | { ok: false; error: string }> {
  const supabase = await createClient();

  const [{ data: contractData, error: contractError }, { data: paymentsData }] = await Promise.all([
    supabase
      .from("contracts")
      .select(
        "id, owner_id, client_id, type, status, principal_amount, late_interest_rate_percent_per_day, client:clients(name), installments(id, number, amount, due_date, status, paid_principal_amount, paid_interest_amount)",
      )
      .eq("id", contractId)
      .single(),
    supabase.from("payments").select("principal_amount, interest_amount").eq("contract_id", contractId),
  ]);

  if (contractError || !contractData) {
    return { ok: false, error: safeError(contractError, "Empréstimo/venda não encontrado.") };
  }
  const contract = contractData as unknown as SettlementContractRow;

  const { settlementInput } = buildSettlementInstallmentInputs(contract);
  const { previousBalance } = allocateSettlement(settlementInput, 0);

  const payments = (paymentsData ?? []) as { principal_amount: number; interest_amount: number }[];
  const totalPaid = roundCents(payments.reduce((sum, p) => sum + p.principal_amount + p.interest_amount, 0));

  let reasonCannotSettle: string | undefined;
  if (contract.status === "cancelado") reasonCannotSettle = "Este empréstimo/venda foi cancelado.";
  else if (contract.status === "quitado") reasonCannotSettle = "Esta dívida já está quitada.";
  else if (settlementInput.length === 0) reasonCannotSettle = "Esta dívida não possui parcelas em aberto.";

  return {
    ok: true,
    summary: {
      clientName: contract.client?.name ?? "—",
      contractLabel: contract.type === "emprestimo" ? "Empréstimo" : "Venda de Produto",
      originalAmount: contract.principal_amount,
      totalPaid,
      outstandingBalance: previousBalance,
      canSettle: !reasonCannotSettle,
      reasonCannotSettle,
    },
  };
}

/**
 * Quitação total de uma dívida: fecha TODAS as parcelas ainda em aberto do
 * contrato de uma vez, registrando como pagamento real exatamente o valor
 * que o usuário informa ter recebido — nunca inventa que o saldo cheio foi
 * recebido quando o valor informado for menor (acordo). A distribuição
 * entre parcelas é sempre feita por `allocateSettlement`
 * (financial-rules.ts, função pura, mesma regra de `splitPayment` já usada
 * em pagamentos normais) — esta função só valida, lê o estado atual e grava
 * atomicamente (`settle_contract_atomic`, migration 0019).
 *
 * Valor recebido maior que o saldo devedor é sempre recusado: o sistema não
 * tem nenhuma noção de crédito/sobra entre dívidas, e inventar uma aqui
 * poderia mascarar dinheiro de OUTRA dívida do mesmo cliente sendo
 * silenciosamente absorvido nesta.
 */
export async function settleContract(contractId: string, input: SettleContractInput): Promise<ActionResult> {
  const parsed = settleContractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const [{ data: existingPayment }, { data: contractData, error: contractError }] = await Promise.all([
    data.idempotencyKey
      ? supabase.from("payments").select("contract_id").eq("idempotency_key", data.idempotencyKey).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("contracts")
      .select(
        "id, owner_id, client_id, type, status, principal_amount, late_interest_rate_percent_per_day, client:clients(name), installments(id, number, amount, due_date, status, paid_principal_amount, paid_interest_amount)",
      )
      .eq("id", contractId)
      .single(),
  ]);

  if (existingPayment) {
    return { ok: true, contractId: existingPayment.contract_id };
  }

  if (contractError || !contractData) {
    return { ok: false, error: safeError(contractError, "Empréstimo/venda não encontrado.") };
  }
  const contract = contractData as unknown as SettlementContractRow;

  if (contract.status === "cancelado") {
    return { ok: false, error: "Este empréstimo/venda foi cancelado. Não é possível quitar." };
  }
  if (contract.status === "quitado") {
    return { ok: false, error: "Esta dívida já está quitada." };
  }

  const { remaining, settlementInput } = buildSettlementInstallmentInputs(contract);
  if (remaining.length === 0) {
    return { ok: false, error: "Esta dívida não possui parcelas em aberto." };
  }

  const amountReceived = roundCents(data.amountReceived);
  const allocation = allocateSettlement(settlementInput, amountReceived);

  if (amountReceived > allocation.previousBalance) {
    return {
      ok: false,
      error: `O valor recebido não pode ser maior que o saldo devedor atual (${formatCurrency(allocation.previousBalance)}).`,
    };
  }
  if (allocation.totalApplied <= 0) {
    return { ok: false, error: "Informe um valor recebido maior que zero." };
  }

  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }
  const createdByEmail = await getCurrentUserEmail(supabase);

  const installmentsPayload = remaining.map((installment) => {
    const applied = allocation.allocations.find((a) => a.id === installment.id)!;
    return {
      id: installment.id,
      expected_paid_principal: installment.paid_principal_amount,
      expected_paid_interest: installment.paid_interest_amount,
      expected_status: installment.status,
      new_paid_principal: roundCents(installment.paid_principal_amount + applied.principalApplied),
      new_paid_interest: roundCents(installment.paid_interest_amount + applied.interestApplied),
    };
  });

  type SettleRpcResult = { payment_id: string; already_existed: boolean };
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("settle_contract_atomic", {
      p_contract_id: contract.id,
      p_owner_id: ownerId,
      p_client_id: contract.client_id,
      p_installments: installmentsPayload,
      p_principal_amount: allocation.totalPrincipalApplied,
      p_interest_amount: allocation.totalInterestApplied,
      p_settlement_previous_balance: allocation.previousBalance,
      // Forma de pagamento não faz parte deste fluxo (acordo de quitação,
      // não uma parcela/método específico) — "outro" é o valor neutro já
      // existente no enum para este caso, nunca afirma algo que não se sabe.
      p_method: "outro",
      p_notes: data.notes || null,
      p_created_by_email: createdByEmail,
      p_idempotency_key: data.idempotencyKey ?? null,
    })
    .single();

  if (rpcError) {
    if (rpcError.message?.includes("installment_changed_concurrently")) {
      return {
        ok: false,
        error: "Os dados desta dívida mudaram enquanto a tela estava aberta. Atualize e tente de novo.",
      };
    }
    if (rpcError.code === "23505" && data.idempotencyKey) {
      return { ok: true, contractId: contract.id };
    }
    return { ok: false, error: safeError(rpcError, "Erro ao quitar a dívida.") };
  }

  const rpcResult = rpcData as unknown as SettleRpcResult | null;
  if (rpcResult?.already_existed) {
    return { ok: true, contractId: contract.id };
  }

  await recalculateContractStatus(supabase, contract.id);

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  if (contract.type === "venda_iphone") {
    revalidatePath("/phones");
  }

  await logAudit(supabase, {
    actorEmail: createdByEmail,
    ownerId,
    action: "contract_settled",
    resourceType: "contract",
    resourceId: contract.id,
    metadata: {
      amountReceived,
      previousBalance: allocation.previousBalance,
      waivedAmount: allocation.waivedAmount,
      principalAmount: allocation.totalPrincipalApplied,
      interestAmount: allocation.totalInterestApplied,
    },
  });

  return { ok: true, contractId: contract.id };
}

/**
 * Abatimento parcial: aplica o valor recebido sobre as parcelas ainda em
 * aberto do contrato (mesma distribuição de `allocateSettlement` — mais
 * antiga primeiro, principal antes do juros), SEM perdoar nada. O que não
 * for coberto continua em aberto normalmente (mesmo status que teria se
 * cada parcela tivesse recebido um pagamento parcial individual via
 * `registerPayment` — a dívida só fecha sozinha se o valor cobrir tudo,
 * nunca é forçada a fechar aqui).
 *
 * Diferente de `settleContract`: cada parcela tocada gera o seu PRÓPRIO
 * registro em `payments` (não um único pagamento consolidado) — do jeito
 * que qualquer pagamento de parcela já aparece no histórico, só que várias
 * de uma vez, numa única transação atômica (`apply_contract_abatement_atomic`,
 * migration 0021).
 */
export async function payDownContractBalance(contractId: string, input: SettleContractInput): Promise<ActionResult> {
  const parsed = settleContractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const [{ data: existingPayment }, { data: contractData, error: contractError }] = await Promise.all([
    data.idempotencyKey
      ? supabase.from("payments").select("contract_id").eq("idempotency_key", data.idempotencyKey).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("contracts")
      .select(
        "id, owner_id, client_id, type, status, principal_amount, late_interest_rate_percent_per_day, client:clients(name), installments(id, number, amount, due_date, status, paid_principal_amount, paid_interest_amount)",
      )
      .eq("id", contractId)
      .single(),
  ]);

  if (existingPayment) {
    return { ok: true, contractId: existingPayment.contract_id };
  }

  if (contractError || !contractData) {
    return { ok: false, error: safeError(contractError, "Empréstimo/venda não encontrado.") };
  }
  const contract = contractData as unknown as SettlementContractRow;

  if (contract.status === "cancelado") {
    return { ok: false, error: "Este empréstimo/venda foi cancelado. Não é possível registrar pagamento nele." };
  }
  if (contract.status === "quitado") {
    return { ok: false, error: "Esta dívida já está quitada." };
  }

  const { remaining, settlementInput } = buildSettlementInstallmentInputs(contract);
  if (remaining.length === 0) {
    return { ok: false, error: "Esta dívida não possui parcelas em aberto." };
  }

  const amountReceived = roundCents(data.amountReceived);
  const allocation = allocateSettlement(settlementInput, amountReceived);

  if (amountReceived > allocation.previousBalance) {
    return {
      ok: false,
      error: `O valor recebido não pode ser maior que o saldo devedor atual (${formatCurrency(allocation.previousBalance)}).`,
    };
  }
  if (allocation.totalApplied <= 0) {
    return { ok: false, error: "Informe um valor recebido maior que zero." };
  }

  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }
  const createdByEmail = await getCurrentUserEmail(supabase);

  // Mesma fórmula de status usada em `registerPayment` pra uma parcela só —
  // aqui aplicada a cada parcela tocada pelo abatimento: totalmente coberta
  // vira "pago"; senão, "atrasado" se já venceu, "parcial" caso contrário.
  // Nunca força "pago" numa parcela que não foi totalmente coberta (essa é
  // exatamente a diferença para a quitação total).
  const installmentsPayload = remaining.map((installment) => {
    const applied = allocation.allocations.find((a) => a.id === installment.id)!;
    const newPaidPrincipal = roundCents(installment.paid_principal_amount + applied.principalApplied);
    const newPaidInterest = roundCents(installment.paid_interest_amount + applied.interestApplied);
    const isFullyPaid = newPaidPrincipal >= roundCents(installment.amount);
    const isStillLate = daysLate(installment.due_date) > 0;
    const newStatus: InstallmentStatus = isFullyPaid ? "pago" : isStillLate ? "atrasado" : "parcial";

    return {
      id: installment.id,
      expected_paid_principal: installment.paid_principal_amount,
      expected_paid_interest: installment.paid_interest_amount,
      expected_status: installment.status,
      principal_applied: applied.principalApplied,
      interest_applied: applied.interestApplied,
      new_paid_principal: newPaidPrincipal,
      new_paid_interest: newPaidInterest,
      new_status: newStatus,
    };
  });

  type AbatementRpcResult = { already_existed: boolean };
  const { data: rpcData, error: rpcError } = await supabase
    .rpc("apply_contract_abatement_atomic", {
      p_contract_id: contract.id,
      p_owner_id: ownerId,
      p_client_id: contract.client_id,
      p_installments: installmentsPayload,
      p_method: "outro",
      p_notes: data.notes || null,
      p_created_by_email: createdByEmail,
      p_idempotency_key: data.idempotencyKey ?? null,
    })
    .single();

  if (rpcError) {
    if (rpcError.message?.includes("installment_changed_concurrently")) {
      return {
        ok: false,
        error: "Os dados desta dívida mudaram enquanto a tela estava aberta. Atualize e tente de novo.",
      };
    }
    if (rpcError.code === "23505" && data.idempotencyKey) {
      return { ok: true, contractId: contract.id };
    }
    return { ok: false, error: safeError(rpcError, "Erro ao registrar o abatimento.") };
  }

  const rpcResult = rpcData as unknown as AbatementRpcResult | null;
  if (rpcResult?.already_existed) {
    return { ok: true, contractId: contract.id };
  }

  await recalculateContractStatus(supabase, contract.id);

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  if (contract.type === "venda_iphone") {
    revalidatePath("/phones");
  }

  await logAudit(supabase, {
    actorEmail: createdByEmail,
    ownerId,
    action: "contract_balance_reduced",
    resourceType: "contract",
    resourceId: contract.id,
    metadata: {
      amountReceived,
      previousBalance: allocation.previousBalance,
      principalAmount: allocation.totalPrincipalApplied,
      interestAmount: allocation.totalInterestApplied,
    },
  });

  return { ok: true, contractId: contract.id };
}

/**
 * Estorna um pagamento lançado errado: devolve principal e juros à parcela,
 * recalcula o status dela e apaga o pagamento, tudo numa única transação
 * (`reverse_payment_atomic`, migration 0025). Só vale para o pagamento
 * mais recente de uma parcela — nunca para entrada, quitação total ou
 * renovação, cujo estado anterior não é recuperável com segurança.
 */
export async function reversePayment(paymentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, contract_id, installment_id, principal_amount, interest_amount, method, paid_at, contract:contracts(status, type)")
    .eq("id", paymentId)
    .single();
  if (paymentError || !payment) {
    return { ok: false, error: safeError(paymentError, "Pagamento não encontrado.") };
  }
  const contract = payment.contract as unknown as { status: ContractStatus; type: ContractType } | null;
  if (contract?.status === "cancelado") {
    return { ok: false, error: "Este contrato foi cancelado. Não é possível estornar pagamentos dele." };
  }

  const { error: rpcError } = await supabase
    .rpc("reverse_payment_atomic", {
      p_payment_id: paymentId,
      p_owner_id: ownerId,
      p_today: getBusinessToday(),
    })
    .single();

  if (rpcError) {
    const reasons: Record<string, string> = {
      not_latest_payment: "Só é possível estornar o pagamento mais recente desta parcela. Estorne os mais novos antes.",
      settlement_not_reversible: "Quitação total não pode ser estornada.",
      down_payment_not_reversible: "Entrada não pode ser estornada.",
      renewal_not_reversible: "Renovação de parcela não pode ser estornada.",
      payment_not_found: "Pagamento não encontrado.",
    };
    const known = Object.keys(reasons).find((key) => rpcError.message?.includes(key));
    return { ok: false, error: known ? reasons[known] : safeError(rpcError, "Erro ao estornar pagamento.") };
  }

  await recalculateContractStatus(supabase, payment.contract_id);

  revalidatePath(`/contracts/${payment.contract_id}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  if (contract?.type === "venda_iphone") {
    revalidatePath("/phones");
  }
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId,
    action: "payment_reversed",
    resourceType: "installment",
    resourceId: payment.installment_id ?? payment.contract_id,
    metadata: {
      paymentId,
      principalAmount: payment.principal_amount,
      interestAmount: payment.interest_amount,
      method: payment.method,
      paidAt: payment.paid_at,
    },
  });
  return { ok: true, contractId: payment.contract_id };
}

export async function registerExpense(input: ExpenseInput): Promise<ActionResult> {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }
  const createdByEmail = await getCurrentUserEmail(supabase);

  const { error } = await supabase.from("expenses").insert({
    owner_id: ownerId,
    description: data.description,
    category: data.category || null,
    amount: roundCents(data.amount),
    method: data.method,
    expense_date: data.expenseDate,
    notes: data.notes || null,
    created_by_email: createdByEmail,
  });

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao registrar despesa.") };
  }

  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/despesas");
  return { ok: true };
}

/** Corrige uma saída lançada errada (o RLS limita à do próprio usuário). */
export async function updateExpense(expenseId: string, input: ExpenseInput): Promise<ActionResult> {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  const { data: updated, error } = await supabase
    .from("expenses")
    .update({
      description: data.description,
      category: data.category || null,
      amount: roundCents(data.amount),
      method: data.method,
      expense_date: data.expenseDate,
      notes: data.notes || null,
    })
    .eq("id", expenseId)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: safeError(error, "Saída não encontrada.") };
  }

  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId,
    action: "expense_updated",
    resourceType: "expense",
    resourceId: expenseId,
    metadata: { amount: roundCents(data.amount), method: data.method, expenseDate: data.expenseDate },
  });
  revalidatePath("/");
  revalidatePath("/despesas");
  return { ok: true };
}

/** Exclui uma saída lançada errada (o RLS limita à do próprio usuário). */
export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  const { data: deleted, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .select("id, description, amount, method, expense_date")
    .maybeSingle();

  if (error || !deleted) {
    return { ok: false, error: safeError(error, "Saída não encontrada.") };
  }

  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId,
    action: "expense_deleted",
    resourceType: "expense",
    resourceId: expenseId,
    metadata: {
      description: deleted.description,
      amount: deleted.amount,
      method: deleted.method,
      expenseDate: deleted.expense_date,
    },
  });
  revalidatePath("/");
  revalidatePath("/despesas");
  return { ok: true };
}

/**
 * Edita uma venda de iPhone já cadastrada (item 21 do pedido): modelo, cor,
 * bateria e custo sempre podem ser corrigidos (não afetam as parcelas já
 * geradas — o custo só entra no cálculo de lucro, nunca no parcelamento).
 * O valor da venda só pode ser alterado enquanto o contrato ainda não tiver
 * nenhum pagamento registrado — nesse caso as parcelas são recalculadas do
 * zero a partir do novo valor, mantendo a mesma quantidade de parcelas,
 * periodicidade e 1º vencimento já definidos na criação.
 */
export async function updateIphoneSale(contractId: string, input: IphoneSaleUpdateInput): Promise<ActionResult> {
  const parsed = iphoneSaleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select(
      "id, owner_id, type, principal_amount, installments_count, periodicity, first_due_date, has_down_payment, down_payment_amount, interest_rate_percent",
    )
    .eq("id", contractId)
    .single();

  if (contractError || !contract) {
    return { ok: false, error: safeError(contractError, "Venda não encontrada.") };
  }
  if (contract.type !== "venda_iphone") {
    return { ok: false, error: "Esta operação não é uma venda de produto." };
  }

  const { data: phone, error: phoneError } = await supabase
    .from("phones")
    .select("id, cost_amount")
    .eq("contract_id", contractId)
    .maybeSingle();

  if (phoneError || !phone) {
    return { ok: false, error: safeError(phoneError, "Celular vinculado não encontrado.") };
  }

  const newSaleAmount = roundCents(data.saleAmount);
  const saleValueChanged = newSaleAmount !== roundCents(contract.principal_amount);

  if (saleValueChanged) {
    const { count: paymentsCount, error: countError } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId);

    if (countError) {
      return { ok: false, error: safeError(countError, "Erro ao verificar pagamentos.") };
    }
    if ((paymentsCount ?? 0) > 0) {
      return {
        ok: false,
        error: "Não é possível alterar o valor da venda depois que algum pagamento foi registrado.",
      };
    }
    if (contract.has_down_payment && contract.down_payment_amount >= newSaleAmount) {
      return { ok: false, error: "O novo valor da venda deve ser maior que a entrada já definida." };
    }
  }

  const { error: phoneUpdateError } = await supabase
    .from("phones")
    .update({
      model: data.model,
      color: data.color || null,
      battery_percent: data.batteryPercent ?? null,
      cost_amount: roundCents(data.costAmount),
      sale_amount: newSaleAmount,
      imei: data.imei ? normalizeImei(data.imei) : null,
    })
    .eq("id", phone.id);

  if (phoneUpdateError) {
    if (phoneUpdateError.code === "23505" && phoneUpdateError.message?.includes("imei")) {
      return { ok: false, error: "Este IMEI já está cadastrado em outro aparelho." };
    }
    return { ok: false, error: safeError(phoneUpdateError, "Erro ao atualizar dados do produto.") };
  }

  if (saleValueChanged) {
    const { totalFinanced } = calculateFinancedAmount({
      contractType: "venda_iphone",
      principalAmount: newSaleAmount,
      installmentsCount: contract.installments_count,
      periodicity: contract.periodicity,
      hasDownPayment: contract.has_down_payment,
      downPaymentAmount: contract.down_payment_amount,
      interestRatePercent: contract.interest_rate_percent,
    });

    const { error: contractUpdateError } = await supabase
      .from("contracts")
      .update({ principal_amount: newSaleAmount, total_amount: totalFinanced })
      .eq("id", contractId);
    if (contractUpdateError) {
      return { ok: false, error: safeError(contractUpdateError, "Erro ao atualizar venda.") };
    }

    // Sem pagamentos ainda (garantido acima): seguro apagar e regenerar
    // todas as parcelas a partir do novo valor.
    const { error: deleteInstallmentsError } = await supabase
      .from("installments")
      .delete()
      .eq("contract_id", contractId);
    if (deleteInstallmentsError) {
      return { ok: false, error: safeError(deleteInstallmentsError, "Erro ao recalcular parcelas.") };
    }

    const newInstallments = generateInstallments({
      totalAmount: totalFinanced,
      installmentsCount: contract.installments_count,
      periodicity: contract.periodicity,
      firstDueDate: contract.first_due_date,
    }).map((installment) => ({
      owner_id: contract.owner_id,
      contract_id: contractId,
      number: installment.number,
      amount: installment.amount,
      due_date: installment.due_date,
    }));

    const { error: installmentsError } = await supabase.from("installments").insert(newInstallments);
    if (installmentsError) {
      return { ok: false, error: safeError(installmentsError, "Erro ao gerar novas parcelas.") };
    }
  }

  revalidatePath("/phones");
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: contract.owner_id,
    action: "iphone_sale_updated",
    resourceType: "contract",
    resourceId: contractId,
    metadata: {
      costAmount: { before: phone.cost_amount, after: roundCents(data.costAmount) },
      saleAmount: { before: contract.principal_amount, after: newSaleAmount },
    },
  });
  return { ok: true, contractId };
}

/**
 * Edita a data em que o dinheiro de um empréstimo já cadastrado saiu de
 * fato da conta (item do fluxo de caixa pedido pelo cliente) — nunca
 * inferida automaticamente, só o que o usuário digitar aqui. Campo vazio
 * volta o contrato para "ainda vai sair" (deixa de debitar o saldo geral).
 * Só se aplica a empréstimo — venda de iPhone tem o custo rastreado à parte
 * em `phones`.
 */
export async function updateContractDisbursement(
  contractId: string,
  input: ContractDisbursementInput,
): Promise<ActionResult> {
  const parsed = contractDisbursementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, type, owner_id")
    .eq("id", contractId)
    .single();

  if (contractError || !contract) {
    return { ok: false, error: safeError(contractError, "Empréstimo não encontrado.") };
  }
  if (contract.type !== "emprestimo") {
    return { ok: false, error: "Esta operação não é um empréstimo." };
  }

  const disbursedAt = data.disbursedAt || null;

  const { error } = await supabase.from("contracts").update({ disbursed_at: disbursedAt }).eq("id", contractId);
  if (error) {
    return { ok: false, error: safeError(error, "Erro ao atualizar a data de saída do dinheiro.") };
  }

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/");
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: contract.owner_id,
    action: "contract_disbursement_updated",
    resourceType: "contract",
    resourceId: contractId,
    metadata: { disbursedAt },
  });
  return { ok: true, contractId };
}

/**
 * Corrige a periodicidade de um contrato (empréstimo OU venda) cadastrada
 * errada — ex.: o cliente combinou semanal, mas foi cadastrado como mensal.
 * Permitido mesmo com parcela já paga: NUNCA mexe na data (nem em nenhum
 * outro campo) de uma parcela que já tem algum pagamento aplicado, total ou
 * parcial — só reencaixa as parcelas ainda em aberto a partir da nova
 * periodicidade, continuando de onde a última parcela travada realmente
 * está (`reflowSchedule`, installments.ts). O valor de cada parcela nunca
 * muda (não depende de periodicidade); só a data de vencimento das
 * parcelas em aberto é ajustada.
 *
 * `weekly_charges` é sincronizado: sai da fila semanal se deixou de ser
 * "semanal", entra se passou a ser (mesma regra usada na criação do
 * contrato, em `createTransaction`).
 */
export async function updateContractPeriodicity(
  contractId: string,
  input: ContractPeriodicityInput,
): Promise<ActionResult> {
  const parsed = contractPeriodicitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { data: contractData, error: contractError } = await supabase
    .from("contracts")
    .select(
      "id, owner_id, client_id, type, status, periodicity, first_due_date, installments(id, number, due_date, paid_principal_amount, paid_interest_amount)",
    )
    .eq("id", contractId)
    .single();

  if (contractError || !contractData) {
    return { ok: false, error: safeError(contractError, "Empréstimo/venda não encontrado.") };
  }
  type PeriodicityContractRow = {
    id: string;
    owner_id: string;
    client_id: string;
    type: ContractType;
    status: ContractStatus;
    periodicity: Periodicity;
    first_due_date: string;
    installments: { id: string; number: number; due_date: string; paid_principal_amount: number; paid_interest_amount: number }[];
  };
  const contract = contractData as unknown as PeriodicityContractRow;

  if (contract.status === "cancelado") {
    return { ok: false, error: "Este empréstimo/venda foi cancelado. Não é possível alterar." };
  }
  if (contract.status === "quitado") {
    return { ok: false, error: "Esta dívida já está quitada — não há parcela em aberto para reorganizar." };
  }
  if (contract.periodicity === data.periodicity) {
    return { ok: true, contractId };
  }

  const scheduleInput = contract.installments.map((installment) => ({
    number: installment.number,
    due_date: installment.due_date,
    locked: installment.paid_principal_amount > 0 || installment.paid_interest_amount > 0,
  }));
  const reflowed = reflowSchedule(scheduleInput, data.periodicity, contract.first_due_date);
  const dueDateByNumber = new Map(reflowed.filter((r) => r.changed).map((r) => [r.number, r.due_date]));

  // Venda de produto (pods): o parcelamento continua tendo de caber em até
  // 4 semanas a partir do 1º vencimento — mesma regra do cadastro.
  if (contract.type === "venda_iphone" && reflowed.length > 0) {
    const lastDueDate = reflowed.reduce((latest, r) => (r.due_date > latest ? r.due_date : latest), reflowed[0].due_date);
    const spanDays = Math.round(
      (parseISO(lastDueDate).getTime() - parseISO(contract.first_due_date).getTime()) / 86_400_000,
    );
    if (spanDays >= PRODUCT_SALE_MAX_WEEKS * 7) {
      return {
        ok: false,
        error: `Com essa periodicidade a venda passaria de ${PRODUCT_SALE_MAX_WEEKS} semanas a partir do 1º vencimento.`,
      };
    }
  }

  if (dueDateByNumber.size > 0) {
    const updates = contract.installments
      .filter((installment) => dueDateByNumber.has(installment.number))
      .map((installment) =>
        supabase
          .from("installments")
          .update({ due_date: dueDateByNumber.get(installment.number) })
          .eq("id", installment.id),
      );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return { ok: false, error: safeError(failed.error, "Erro ao recalcular datas das parcelas.") };
    }
  }

  const { error: contractUpdateError } = await supabase
    .from("contracts")
    .update({ periodicity: data.periodicity })
    .eq("id", contractId);
  if (contractUpdateError) {
    return { ok: false, error: safeError(contractUpdateError, "Erro ao atualizar periodicidade.") };
  }

  const wasWeekly = contract.periodicity === "semanal";
  const isWeekly = data.periodicity === "semanal";
  if (wasWeekly && !isWeekly) {
    await supabase.from("weekly_charges").delete().eq("contract_id", contractId);
  } else if (!wasWeekly && isWeekly) {
    await supabase.from("weekly_charges").insert({
      owner_id: contract.owner_id,
      contract_id: contractId,
      client_id: contract.client_id,
      dia_semana_disparo: toBusinessWeekday(contract.first_due_date),
      proximo_disparo: contract.first_due_date,
      status: "PENDENTE",
    });
  }

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/");
  revalidatePath("/clientes");
  revalidatePath("/debtors");
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: contract.owner_id,
    action: "contract_periodicity_updated",
    resourceType: "contract",
    resourceId: contractId,
    metadata: {
      before: contract.periodicity,
      after: data.periodicity,
      installmentsRescheduled: dueDateByNumber.size,
    },
  });
  return { ok: true, contractId };
}

export async function updateClientAddress(clientId: string, input: ClientAddressInput): Promise<ActionResult> {
  const parsed = clientAddressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from("clients")
    .update({
      street: data.street || null,
      street_number: data.streetNumber || null,
      neighborhood: data.neighborhood || null,
      city: data.city || null,
      state: data.state || null,
      zip_code: data.zipCode || null,
    })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao atualizar endereço.") };
  }

  revalidatePath("/");
  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Edita os dados cadastrais do cliente (nome, telefone, e-mail, notas) —
 * nunca toca em contratos, parcelas ou pagamentos: é sempre um UPDATE na
 * própria linha de `clients`, então os empréstimos/vendas já vinculados
 * continuam associados ao mesmo `client_id`, sem duplicar nem recriar nada.
 * O telefone é normalizado (só dígitos) antes de salvar, igual ao cadastro
 * inicial em `createTransaction` — os próximos lembretes usam o número novo.
 */
export async function updateClientInfo(clientId: string, input: ClientInfoInput): Promise<ActionResult> {
  const parsed = clientInfoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from("clients")
    .update({
      name: data.name,
      phone: onlyDigits(data.phone),
      email: data.email || null,
      notes: data.notes || null,
    })
    .eq("id", clientId);

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao atualizar cliente.") };
  }

  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: await getCurrentUserId(supabase),
    action: "client_updated",
    resourceType: "client",
    resourceId: clientId,
  });

  revalidatePath("/");
  revalidatePath("/clientes");
  return { ok: true };
}

const DOCUMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * Foto/PDF do documento do cliente, enviado para um bucket de Storage
 * PRIVADO (`client-documents`, criado na migration 0006) — nunca fica
 * público; só é acessível via signed URL gerada no servidor (ver
 * `getClientDocumentSignedUrl`).
 */
export async function uploadClientDocument(clientId: string, formData: FormData): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecione um arquivo." };
  }
  if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
    return { ok: false, error: "Arquivo muito grande (máx. 8MB)." };
  }

  // Nunca confia no `file.type` (Content-Type declarado pelo navegador) nem
  // na extensão do nome do arquivo — ambos podem ser forjados por quem
  // monta a requisição manualmente. O conteúdo real é inspecionado pela
  // assinatura de bytes; SVG e qualquer outro formato fora da lista
  // (inclusive HTML/executáveis disfarçados de imagem) são rejeitados.
  const detected = await detectSafeDocumentType(file);
  if (!detected) {
    return { ok: false, error: "Envie um arquivo JPG, PNG, WEBP ou PDF válido." };
  }

  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("document_photo_path")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    return { ok: false, error: safeError(clientError, "Cliente não encontrado.") };
  }

  // Nome sempre gerado pelo servidor (timestamp + extensão detectada, nunca
  // o nome enviado pelo usuário) — elimina qualquer risco de path traversal
  // ou colisão proposital com outro arquivo.
  const path = `${clientId}/${Date.now()}.${detected.extension}`;

  const { error: uploadError } = await supabase.storage
    .from("client-documents")
    .upload(path, file, { contentType: detected.mimeType, upsert: false });

  if (uploadError) {
    return { ok: false, error: safeError(uploadError, "Erro ao enviar arquivo.") };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ document_photo_path: path })
    .eq("id", clientId);

  if (updateError) {
    // Reverte o upload para não deixar um arquivo órfão sem referência.
    await supabase.storage.from("client-documents").remove([path]);
    return { ok: false, error: safeError(updateError, "Erro ao vincular documento ao cliente.") };
  }

  if (client.document_photo_path) {
    await supabase.storage.from("client-documents").remove([client.document_photo_path]);
  }

  revalidatePath("/");
  revalidatePath("/clientes");
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: await getCurrentUserId(supabase),
    action: "client_document_uploaded",
    resourceType: "client",
    resourceId: clientId,
    metadata: { mimeType: detected.mimeType },
  });
  return { ok: true };
}

export async function deleteClientDocument(clientId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("document_photo_path")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    return { ok: false, error: safeError(clientError, "Cliente não encontrado.") };
  }
  if (!client.document_photo_path) {
    return { ok: true };
  }

  await supabase.storage.from("client-documents").remove([client.document_photo_path]);

  const { error: updateError } = await supabase
    .from("clients")
    .update({ document_photo_path: null })
    .eq("id", clientId);

  if (updateError) {
    return { ok: false, error: safeError(updateError, "Erro ao remover documento.") };
  }

  revalidatePath("/");
  revalidatePath("/clientes");
  await logAudit(supabase, {
    actorEmail: await getCurrentUserEmail(supabase),
    ownerId: await getCurrentUserId(supabase),
    action: "client_document_deleted",
    resourceType: "client",
    resourceId: clientId,
  });
  return { ok: true };
}

export async function sendReminderAction(installmentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const result = await sendCollectionReminder(supabase, installmentId);

  const { data: installment } = await supabase
    .from("installments")
    .select("contract_id")
    .eq("id", installmentId)
    .single();

  if (installment) {
    revalidatePath(`/contracts/${installment.contract_id}`);
  }

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Registra que o usuário abriu o WhatsApp para cobrar uma parcela (botão
 * "Enviar Lembrete", que agora monta um link `wa.me` com a mensagem
 * preenchida em vez de enviar pela API automaticamente). Isto só prova que
 * a conversa foi aberta no navegador/app do usuário — NUNCA que a
 * mensagem foi de fato enviada ou recebida pelo cliente, por isso a tela
 * rotula como "lembrete iniciado", nunca "enviado".
 */
export async function markReminderOpened(installmentId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: installment, error: fetchError } = await supabase
    .from("installments")
    .select("contract_id, reminder_count")
    .eq("id", installmentId)
    .maybeSingle();

  if (fetchError || !installment) {
    return { ok: false, error: safeError(fetchError, "Parcela não encontrada.") };
  }

  const { error } = await supabase
    .from("installments")
    .update({
      reminder_sent_at: new Date().toISOString(),
      reminder_count: (installment.reminder_count ?? 0) + 1,
    })
    .eq("id", installmentId);

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao registrar lembrete.") };
  }

  revalidatePath(`/contracts/${installment.contract_id}`);
  return { ok: true };
}

export async function saveMessageSettings(input: MessageSettingsInput): Promise<ActionResult> {
  const parsed = messageSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  // O formulário nunca reenvia um segredo já salvo (settings-form.tsx só
  // mostra um placeholder) — "em branco" aqui sempre significa "manter o
  // valor atual", nunca "apagar". Só é sobrescrito se o usuário digitar um
  // valor novo. O RLS já restringe as duas operações abaixo à própria
  // configuração do usuário autenticado — nunca enxerga nem desativa a de
  // outro usuário.
  const { data: current } = await supabase
    .from("message_settings")
    .select("api_key, auth_token")
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .maybeSingle();

  await supabase
    .from("message_settings")
    .update({ is_active: false })
    .eq("owner_id", ownerId)
    .eq("is_active", true);

  const { error } = await supabase.from("message_settings").insert({
    owner_id: ownerId,
    provider: data.provider,
    base_url: data.baseUrl || null,
    api_key: data.apiKey || current?.api_key || null,
    instance_id: data.instanceId || null,
    sender_number: data.senderNumber || null,
    auth_token: data.authToken || current?.auth_token || null,
    message_template: data.messageTemplate,
    template_name: data.templateName || null,
    template_language: data.templateLanguage || "pt_BR",
    admin_alert_phone: data.adminAlertPhone ? onlyDigits(data.adminAlertPhone) : null,
    is_active: true,
  });

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao salvar configurações.") };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Configurações gerais (uma linha por usuário): juros de atraso padrão —
 * copiado para cada contrato NOVO, nunca altera os existentes — e como o
 * botão de cobrança abre o WhatsApp.
 */
export async function saveBusinessSettings(input: BusinessSettingsInput): Promise<ActionResult> {
  const parsed = businessSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;
  const supabase = await createClient();
  const ownerId = await getCurrentUserId(supabase);
  if (!ownerId) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase.from("business_settings").upsert(
    {
      owner_id: ownerId,
      late_interest_rate_percent_per_day: data.lateInterestRatePercentPerDay,
      whatsapp_open_mode: data.whatsappOpenMode,
      business_whatsapp_number: data.businessWhatsappNumber ? onlyDigits(data.businessWhatsappNumber) : null,
    },
    { onConflict: "owner_id" },
  );

  if (error) {
    return { ok: false, error: safeError(error, "Erro ao salvar configurações.") };
  }

  revalidatePath("/settings");
  revalidatePath("/debtors");
  return { ok: true };
}

export async function sendTestMessage(phone: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: settings, error: settingsError } = await supabase
    .from("message_settings")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  if (settingsError || !settings) {
    return { ok: false, error: "Nenhuma configuração ativa encontrada." };
  }

  const { createWhatsAppProvider } = await import("@/lib/whatsapp/providers");
  const { formatDate } = await import("@/lib/utils");

  try {
    const provider = createWhatsAppProvider(settings);
    const result = await provider.send(phone, {
      text: "Mensagem de teste do sistema de cobrança. Se você recebeu isso, a integração está funcionando corretamente.",
      // Parâmetros de amostra — usados apenas pelo provider Meta Cloud API,
      // que precisa preencher as variáveis do template aprovado mesmo num teste.
      templateParams: ["Cliente Teste", "1/1", "0,00", formatDate(new Date())],
    });
    return result.ok ? { ok: true } : { ok: false, error: `Falha ao enviar (HTTP ${result.statusCode}).` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro ao enviar mensagem de teste." };
  }
}
