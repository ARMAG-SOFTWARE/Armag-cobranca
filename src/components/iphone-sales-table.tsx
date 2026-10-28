"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractStatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { DeleteContractDialog } from "@/components/delete-contract-dialog";
import { IphoneSaleEditDialog } from "@/components/iphone-sale-edit-dialog";
import type { IphoneSale } from "@/lib/iphone-sales";
import { formatCurrency } from "@/lib/utils";

export function IphoneSalesTable({ sales }: { sales: IphoneSale[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sales;
    // Guarda contra string vazia: `q.replace(/\D/g, "")` fica vazio pra uma
    // busca sem dígitos (nome/modelo/cor), e "".includes("") é sempre true —
    // sem este guard, qualquer busca por nome "encontraria" todo mundo
    // também pelo IMEI (mesmo bug já corrigido em clients-table.tsx).
    const qDigits = q.replace(/\D/g, "");
    return sales.filter(
      (sale) =>
        sale.client.name.toLowerCase().includes(q) ||
        sale.phone.model.toLowerCase().includes(q) ||
        (sale.phone.color ?? "").toLowerCase().includes(q) ||
        (qDigits.length > 0 && (sale.phone.imei ?? "").includes(qDigits)),
    );
  }, [sales, query]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Buscar por cliente, produto, cor ou IMEI..."
        className="sm:w-72"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <SpotlightCard className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>IMEI</TableHead>
              <TableHead>Custo</TableHead>
              <TableHead>Venda</TableHead>
              <TableHead>Lucro</TableHead>
              <TableHead>Recebido</TableHead>
              <TableHead>Pendente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  Nenhuma venda de produto encontrada.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((sale) => (
              <TableRow key={sale.phone.id}>
                <TableCell>
                  <Link href={`/contracts/${sale.contract.id}`} className="font-medium text-foreground hover:underline">
                    {sale.client.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{sale.phone.model}</span>
                    <span className="text-xs text-muted-foreground">
                      {[sale.phone.color, sale.phone.battery_percent !== null ? `${sale.phone.battery_percent}% bateria` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {sale.phone.imei ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{sale.phone.imei}</span>
                      <CopyButton value={sale.phone.imei} label="Copiar" />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{formatCurrency(sale.phone.cost_amount)}</TableCell>
                <TableCell>{formatCurrency(sale.contract.principal_amount)}</TableCell>
                <TableCell>
                  <span className={sale.profit >= 0 ? "font-medium text-success" : "font-medium text-destructive"}>
                    {formatCurrency(sale.profit)}
                  </span>
                </TableCell>
                <TableCell>{formatCurrency(sale.received)}</TableCell>
                <TableCell>{formatCurrency(sale.pending)}</TableCell>
                <TableCell>
                  <ContractStatusBadge status={sale.contract.status} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <IphoneSaleEditDialog sale={sale} />
                    <DeleteContractDialog
                      contract={{
                        id: sale.contract.id,
                        type: "venda_iphone",
                        principal_amount: sale.contract.principal_amount,
                        installments_count: sale.contract.installments_count,
                        total_amount: sale.contract.total_amount,
                        status: sale.contract.status,
                      }}
                      clientName={sale.client.name}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SpotlightCard>
    </div>
  );
}
