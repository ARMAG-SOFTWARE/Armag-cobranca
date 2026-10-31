"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/masked-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getBusinessToday } from "@/lib/date-utils";
import { firstChargeDate, splitAmount } from "@/lib/installments";
import {
  calculateFinancedAmount,
  contractDurationWeeks,
  roundCents,
  DEFAULT_LOAN_INTEREST_RATE_PERCENT,
  DEFAULT_PRODUCT_INTEREST_RATE_PERCENT,
  PRODUCT_SALE_MAX_WEEKS,
  WEEKS_PER_INSTALLMENT,
} from "@/lib/financial-rules";
import { formatCurrency, formatDate, optionalNumber } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS } from "@/lib/types";
import { transactionSchema, type TransactionInput } from "@/lib/validations";
import { createTransaction } from "@/app/actions";

const today = () => getBusinessToday();

/** Semanas com até 2 casas, no formato brasileiro (ex.: 1,43). */
function formatWeeks(weeks: number) {
  return weeks.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function NewTransactionDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransactionInput>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: "emprestimo",
      periodicity: "mensal",
      installmentsCount: 1,
      firstDueDate: today(),
      interestRatePercent: DEFAULT_LOAN_INTEREST_RATE_PERCENT,
      disbursedAt: "",
      hasDownPayment: false,
      downPaymentAmount: 0,
      downPaymentMethod: "dinheiro",
      phoneModel: "",
      phoneColor: "",
      phoneCostAmount: 0,
      phoneImei: "",
    },
  });

  const type = watch("type");
  const isIphoneSale = type === "venda_iphone";
  const isLoan = type === "emprestimo";
  const hasDownPayment = isIphoneSale && Boolean(watch("hasDownPayment"));
  const totalAmount = Number(watch("totalAmount")) || 0;
  const downPaymentAmount = hasDownPayment ? Number(watch("downPaymentAmount")) || 0 : 0;
  const installmentsCount = Number(watch("installmentsCount")) || 1;
  const phoneCostAmount = isIphoneSale ? Number(watch("phoneCostAmount")) || 0 : 0;
  const periodicity = watch("periodicity");
  const interestRatePercent = Number(watch("interestRatePercent")) || 0;
  const durationWeeks = contractDurationWeeks(installmentsCount, periodicity);
  const firstDueDate = watch("firstDueDate");
  const effectiveFirstDueDate =
    firstDueDate && firstDueDate.length === 10 ? firstChargeDate(firstDueDate, periodicity) : firstDueDate;

  const { totalFinanced, markupAmount, ratePercent } =
    totalAmount > 0
      ? calculateFinancedAmount({
          contractType: type,
          principalAmount: totalAmount,
          installmentsCount,
          periodicity,
          hasDownPayment,
          downPaymentAmount,
          interestRatePercent,
        })
      : { totalFinanced: 0, markupAmount: 0, ratePercent: 0 };

  const previewAmounts =
    totalFinanced > 0 && installmentsCount > 0 ? splitAmount(totalFinanced, installmentsCount) : [];

  // Lucro da venda inclui o juros da venda: tudo o que o cliente vai pagar
  // (entrada + parcelas) menos o custo do produto.
  const iphoneProfit =
    isIphoneSale && totalAmount > 0 ? roundCents(totalFinanced + downPaymentAmount - phoneCostAmount) : 0;

  // Entrada e detalhes do iPhone só existem para venda de iPhone: ao trocar
  // o tipo, zera esses campos para não deixar um valor "fantasma" que
  // reprovaria a validação.
  useEffect(() => {
    if (!isIphoneSale) {
      setValue("hasDownPayment", false);
      setValue("downPaymentAmount", 0);
      setValue("phoneModel", "");
      setValue("phoneColor", "");
      setValue("phoneBatteryPercent", undefined);
      setValue("phoneCostAmount", 0);
      setValue("phoneImei", "");
    }
  }, [isIphoneSale, setValue]);

  // Cada tipo tem a sua sugestão de juros (empréstimo: 7,5% por semana;
  // venda de produto: 20% fixo) — ao trocar o tipo, volta para a sugestão
  // dele. Data de saída do dinheiro só existe para empréstimo.
  useEffect(() => {
    setValue(
      "interestRatePercent",
      isLoan ? DEFAULT_LOAN_INTEREST_RATE_PERCENT : DEFAULT_PRODUCT_INTEREST_RATE_PERCENT,
    );
    if (!isLoan) {
      setValue("disbursedAt", "");
    }
  }, [isLoan, setValue]);

  const onSubmit = handleSubmit(async (data) => {
    const result = await createTransaction(data);
    if (result.ok) {
      toast.success("Cadastro criado com sucesso.");
      reset();
      setOpen(false);
      router.refresh();
      if (result.contractId) {
        router.push(`/contracts/${result.contractId}`);
      }
    } else {
      toast.error(result.error ?? "Erro ao criar cadastro.");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="glow" size="lg">
          <PlusIcon />
          Novo Cadastro
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo empréstimo / venda</DialogTitle>
          <DialogDescription>
            Cadastre o cliente (ou reutilize um existente pelo telefone) e os detalhes do parcelamento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="clientName">Nome do cliente</Label>
              <Input id="clientName" placeholder="Ex: João Silva" {...register("clientName")} />
              {errors.clientName && <p className="text-xs text-destructive">{errors.clientName.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="clientPhone">Telefone / WhatsApp</Label>
              <MaskedInput mask="phone" id="clientPhone" placeholder="(11) 91234-5678" {...register("clientPhone")} />
              {errors.clientPhone && <p className="text-xs text-destructive">{errors.clientPhone.message}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="type">Tipo de operação</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emprestimo">Empréstimo</SelectItem>
                      <SelectItem value="venda_iphone">Venda de Produto</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Input id="description" placeholder="Ex: Pod descartável, sabor menta" {...register("description")} />
            </div>
          </div>

          {type === "venda_iphone" && (
            <div className="grid gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="hasDownPayment">Deu entrada?</Label>
                  <p className="text-xs text-muted-foreground">
                    A entrada é recebida à vista; o restante (valor do produto menos a entrada) é dividido nas
                    parcelas, sem juros automático — o valor é o que você digitar.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="hasDownPayment"
                  render={({ field }) => (
                    <Switch id="hasDownPayment" checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                  )}
                />
              </div>

              {hasDownPayment && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="downPaymentAmount">Valor da entrada (R$)</Label>
                    <Input
                      id="downPaymentAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0,00"
                      {...register("downPaymentAmount", { valueAsNumber: true })}
                    />
                    {errors.downPaymentAmount && (
                      <p className="text-xs text-destructive">{errors.downPaymentAmount.message}</p>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="downPaymentMethod">Forma de pagamento da entrada</Label>
                    <Controller
                      control={control}
                      name="downPaymentMethod"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="downPaymentMethod">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="phoneModel">Nome do produto</Label>
                  <Input id="phoneModel" placeholder="Ex: Pod descartável, sabor menta" {...register("phoneModel")} />
                  {errors.phoneModel && <p className="text-xs text-destructive">{errors.phoneModel.message}</p>}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="phoneColor">Cor (opcional)</Label>
                  <Input id="phoneColor" placeholder="Ex: Grafite" {...register("phoneColor")} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="phoneBatteryPercent">Saúde da bateria % (opcional)</Label>
                  <Input
                    id="phoneBatteryPercent"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Ex: 87"
                    {...register("phoneBatteryPercent", { setValueAs: optionalNumber })}
                  />
                  {errors.phoneBatteryPercent && (
                    <p className="text-xs text-destructive">{errors.phoneBatteryPercent.message}</p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="phoneCostAmount">Custo do produto (R$)</Label>
                  <Input
                    id="phoneCostAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    {...register("phoneCostAmount", { valueAsNumber: true })}
                  />
                  {errors.phoneCostAmount && (
                    <p className="text-xs text-destructive">{errors.phoneCostAmount.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Usado para calcular o lucro real da venda (valor da venda − custo).
                  </p>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="phoneImei">IMEI do aparelho (opcional, só para celulares)</Label>
                <Input id="phoneImei" placeholder="15 dígitos — pode ser adicionado depois" {...register("phoneImei")} />
                {errors.phoneImei && <p className="text-xs text-destructive">{errors.phoneImei.message}</p>}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="totalAmount">
                {type === "venda_iphone" ? "Valor do produto (R$)" : "Valor emprestado (R$)"}
              </Label>
              <Input id="totalAmount" type="number" step="0.01" min="0" placeholder="0,00" {...register("totalAmount", { valueAsNumber: true })} />
              {errors.totalAmount && <p className="text-xs text-destructive">{errors.totalAmount.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="installmentsCount">Qtd. de parcelas</Label>
              <Input id="installmentsCount" type="number" min="1" max="60" {...register("installmentsCount", { valueAsNumber: true })} />
              {errors.installmentsCount && (
                <p className="text-xs text-destructive">{errors.installmentsCount.message}</p>
              )}
              {isIphoneSale && !errors.installmentsCount && (
                <p className="text-xs text-muted-foreground">
                  Até {PRODUCT_SALE_MAX_WEEKS} semanas a partir do 1º vencimento.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="periodicity">Periodicidade</Label>
              <Controller
                control={control}
                name="periodicity"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="periodicity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="diaria">Diária</SelectItem>
                      <SelectItem value="semanal">Semanal</SelectItem>
                      <SelectItem value="quinzenal">Quinzenal</SelectItem>
                      <SelectItem value="mensal">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="firstDueDate">Data do 1º vencimento</Label>
            <Input id="firstDueDate" type="date" {...register("firstDueDate")} />
            {errors.firstDueDate && <p className="text-xs text-destructive">{errors.firstDueDate.message}</p>}
            {!errors.firstDueDate && periodicity === "diaria" && (
              <p className="text-xs text-muted-foreground">
                Diária: de segunda a sábado (domingo não vence).
                {effectiveFirstDueDate !== firstDueDate &&
                  ` Como a data escolhida é domingo, o 1º vencimento será na segunda-feira, ${formatDate(effectiveFirstDueDate)}.`}
              </p>
            )}
          </div>

          <div className="grid gap-4 rounded-md border p-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="interestRatePercent">
                {isLoan ? "Taxa de juros por semana (%)" : "Juros da venda (%)"}
              </Label>
              <Input
                id="interestRatePercent"
                type="number"
                step="0.01"
                min="0"
                placeholder={isLoan ? "7,5" : "20"}
                {...register("interestRatePercent", { valueAsNumber: true })}
              />
              {errors.interestRatePercent && (
                <p className="text-xs text-destructive">{errors.interestRatePercent.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {isLoan
                  ? `Sugestão: 7,5% por semana (${formatWeeks(DEFAULT_LOAN_INTEREST_RATE_PERCENT * WEEKS_PER_INSTALLMENT.diaria)}% por parcela diária). Este parcelamento = ${formatWeeks(durationWeeks)} semana(s) → ${roundCents(interestRatePercent * durationWeeks)}%.`
                  : "Sugestão: 20%, aplicado uma única vez sobre o valor do produto (menos a entrada)."}
              </p>
            </div>
            {isLoan && (
              <div className="grid gap-1.5">
                <Label htmlFor="disbursedAt">Dinheiro já saiu da conta? (opcional)</Label>
                <Input id="disbursedAt" type="date" max={today()} {...register("disbursedAt")} />
                <p className="text-xs text-muted-foreground">
                  Deixe em branco se o dinheiro ainda vai saír — só debita o saldo geral de caixa depois de confirmado.
                </p>
              </div>
            )}
          </div>

          {previewAmounts.length > 0 && (
            <div className="grid gap-1 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <p>
                {type === "venda_iphone" ? "Valor do produto" : "Valor emprestado"}: {formatCurrency(totalAmount)}
                {hasDownPayment && downPaymentAmount > 0 ? ` · Entrada: ${formatCurrency(downPaymentAmount)}` : ""}
                {ratePercent > 0
                  ? isLoan
                    ? ` · Juros ${interestRatePercent}%/semana × ${formatWeeks(durationWeeks)} sem. = ${ratePercent}% (${formatCurrency(markupAmount)})`
                    : ` · Juros ${ratePercent}% (${formatCurrency(markupAmount)})`
                  : ""}
              </p>
              <p className="font-medium text-foreground">
                Total previsto: {formatCurrency(totalFinanced)} — {previewAmounts.length}x de{" "}
                {formatCurrency(previewAmounts[0])}
                {previewAmounts.length > 1 && previewAmounts.at(-1) !== previewAmounts[0]
                  ? ` (última parcela ${formatCurrency(previewAmounts.at(-1)!)})`
                  : ""}
              </p>
              {isIphoneSale && phoneCostAmount > 0 && (
                <p className="font-medium">
                  Custo do produto: {formatCurrency(phoneCostAmount)} ·{" "}
                  <span className={iphoneProfit >= 0 ? "text-success" : "text-destructive"}>
                    {iphoneProfit >= 0 ? "Lucro" : "Prejuízo"}: {formatCurrency(Math.abs(iphoneProfit))}
                  </span>
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="glow" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar cadastro"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
