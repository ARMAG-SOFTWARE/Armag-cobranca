"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarClockIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { signOut } from "@/app/auth-actions";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof UsersIcon; exact: boolean };

const FINANCEIRO_ITEMS: NavItem[] = [
  { href: "/", label: "Visão Geral", icon: LayoutDashboardIcon, exact: true },
  { href: "/clientes", label: "Clientes", icon: UsersIcon, exact: false },
  { href: "/debtors", label: "Devedores do Dia", icon: CalendarClockIcon, exact: false },
];

const LOJA_ITEMS: NavItem[] = [{ href: "/phones", label: "Vendas de Produtos", icon: PackageIcon, exact: false }];

const SISTEMA_ITEMS: NavItem[] = [
  { href: "/backups", label: "Backups", icon: ShieldCheckIcon, exact: false },
  { href: "/settings", label: "Configurações", icon: SettingsIcon, exact: false },
];

function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="recebe-logo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff3548" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#e5233d" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#e5233d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#recebe-logo-glow)" />
      <circle cx="50" cy="50" r="29" fill="#0a0a0c" stroke="#ff3548" strokeWidth="2.5" />
      <ellipse cx="50" cy="50" rx="5.5" ry="19" fill="#ff3548" />
    </svg>
  );
}

function NavGroup({ title, items, pathname }: { title: string; items: NavItem[]; pathname: string }) {
  return (
    <div>
      <div className="mb-2 px-2.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SidebarContent({ userEmail, pathname }: { userEmail: string | null; pathname: string }) {
  return (
    <div className="flex h-full flex-col gap-7 p-4">
      <Link href="/" className="flex items-center gap-2.5 px-1">
        <BrandMark />
        <div>
          <div className="font-display text-lg leading-none font-bold tracking-[0.2em]">RECEBE</div>
          <div className="mt-1 text-[8.5px] tracking-[0.15em] text-muted-foreground uppercase">
            Cobrança sob controle
          </div>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-6">
        <NavGroup title="Financeiro" items={FINANCEIRO_ITEMS} pathname={pathname} />
        <NavGroup title="Loja" items={LOJA_ITEMS} pathname={pathname} />
        <NavGroup title="Sistema" items={SISTEMA_ITEMS} pathname={pathname} />
      </nav>

      {userEmail && (
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/20 text-xs font-bold text-success">
              {userEmail.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-[12.5px] text-foreground">{userEmail}</span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="Sair"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-destructive"
            >
              <LogOutIcon className="size-4" />
              <span className="sr-only">Sair</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AppNav({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      {/* Desktop / tablet: barra lateral fixa */}
      <aside className="sticky top-0 hidden h-svh w-[260px] shrink-0 border-r border-white/10 bg-card md:flex">
        <SidebarContent userEmail={userEmail} pathname={pathname} />
      </aside>

      {/* Celular: topo compacto + gaveta deslizante */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/10 bg-background px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="font-display text-sm font-bold tracking-[0.2em]">RECEBE</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="flex size-9 items-center justify-center rounded-lg border border-white/10 text-muted-foreground"
        >
          <MenuIcon className="size-4.5" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[80vw] max-w-[300px] border-r border-white/10 bg-card">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
              className="absolute top-4 right-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground"
            >
              <XIcon className="size-4.5" />
            </button>
            <SidebarContent userEmail={userEmail} pathname={pathname} />
          </div>
        </div>
      )}
    </>
  );
}
