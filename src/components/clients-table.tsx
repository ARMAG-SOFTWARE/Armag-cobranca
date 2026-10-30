"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractStatusBadge, ContractTypeBadge } from "@/components/status-badge";
import { PERIODICITY_LABELS, type Client, type Contract } from "@/lib/types";
import { formatCurrency, formatPhone, initials } from "@/lib/utils";

/** Só o que a tabela exibe/filtra — a página busca exatamente estas colunas. */
export type ClientsTableContract = Pick<
  Contract,
  "id" | "type" | "description" | "installments_count" | "periodicity" | "status" | "total_amount"
> & { client: Pick<Client, "name" | "phone"> };

// "Todos" mostra só o que está em andamento (ativo + inadimplente) — quitados
// e cancelados poluíam a listagem. Eles ficam na aba "Encerrados", para
// consulta do histórico.
type FilterTab = "todos" | "ativo" | "inadimplente" | "encerrados";

const TABS: { value: FilterTab; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "ativo", label: "Ativos" },
  { value: "inadimplente", label: "Inadimplentes" },
  { value: "encerrados", label: "Encerrados" },
];

function isClosed(status: ClientsTableContract["status"]) {
  return status === "quitado" || status === "cancelado";
}

export function ClientsTable({ contracts }: { contracts: ClientsTableContract[] }) {
  const [tab, setTab] = useState<FilterTab>("todos");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // `q.replace(/\D/g, "")` fica vazio pra uma busca por nome (sem
    // dígitos) — sem este guard, `phone.includes("")` é sempre `true`
    // (string vazia é substring de qualquer coisa), e o `||` fazia a busca
    // "achar" todo mundo, não só quem batia com o nome digitado. Era
    // exatamente isso que fazia a pesquisa parecer quebrada.
    const qDigits = q.replace(/\D/g, "");
    return contracts.filter((contract) => {
      if (tab === "encerrados") {
        if (!isClosed(contract.status)) return false;
      } else if (isClosed(contract.status)) {
        return false;
      } else if (tab !== "todos" && contract.status !== tab) {
        return false;
      }
      if (!q) return true;
      return (
        contract.client.name.toLowerCase().includes(q) ||
        (qDigits.length > 0 && contract.client.phone.includes(qDigits)) ||
        (contract.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [contracts, tab, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList>
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="relative sm:w-72">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <SpotlightCard className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone / WhatsApp</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor total</TableHead>
              <TableHead>Parcelas</TableHead>
              <TableHead>Periodicidade</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((contract) => (
              <TableRow key={contract.id} className="cursor-pointer hover:bg-primary/8">
                <TableCell>
                  <Link
                    href={`/contracts/${contract.id}`}
                    className="-mx-4 -my-3 flex items-center gap-3 px-4 py-3 font-medium text-foreground"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent-cyan text-xs font-bold text-primary-foreground">
                      {initials(contract.client.name)}
                    </span>
                    {contract.client.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    {formatPhone(contract.client.phone)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    <ContractTypeBadge type={contract.type} />
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    {formatCurrency(contract.total_amount)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    {contract.installments_count}x
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    {PERIODICITY_LABELS[contract.periodicity]}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/contracts/${contract.id}`} className="-mx-4 -my-3 block px-4 py-3">
                    <ContractStatusBadge status={contract.status} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SpotlightCard>
    </div>
  );
}
