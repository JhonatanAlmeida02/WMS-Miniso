import { useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import {
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  ScanBarcode,
  Store,
  Users,
  Waypoints,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Logo } from "./Logo";
import { Carregando, cx } from "./ui";

const MENU = [
  { para: "/painel", texto: "Painel", icone: LayoutDashboard },
  { para: "/remessas", texto: "Remessas", icone: PackagePlus },
  { para: "/distribuicao", texto: "Distribuição", icone: Waypoints },
  { para: "/conferencia", texto: "Conferência", icone: ClipboardCheck },
  { para: "/bips", texto: "Log de bips", icone: History },
  { para: "/usuarios", texto: "Usuários", icone: Users },
  { para: "/lojas", texto: "Lojas", icone: Store },
];

/** Exige login (e, se pedido, perfil de supervisor). */
export function Protegido({ supervisor, children }: { supervisor?: boolean; children: ReactNode }) {
  const { carregando, sessao, perfil } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao || !perfil) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  if (supervisor && perfil.papel !== "supervisor") return <Navigate to="/separacao" replace />;
  return <>{children}</>;
}

function Iniciais({ nome }: { nome: string }) {
  const ini = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amarelo text-sm font-semibold text-navy" aria-hidden>
      {ini}
    </span>
  );
}

function Navegacao({ aoNavegar }: { aoNavegar?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {MENU.map(({ para, texto, icone: Icone }) => (
        <NavLink
          key={para}
          to={para}
          onClick={aoNavegar}
          className={({ isActive }) =>
            cx(
              "relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
              isActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-amarelo" aria-hidden />}
              <Icone className={cx("size-5", isActive ? "text-amarelo" : "")} aria-hidden />
              {texto}
            </>
          )}
        </NavLink>
      ))}
      <div className="my-3 h-px bg-white/10" />
      <NavLink
        to="/separacao"
        onClick={aoNavegar}
        className="flex h-11 items-center gap-3 rounded-xl bg-ciano px-3 text-[15px] font-medium text-navy hover:bg-[#00b2a3]"
      >
        <ScanBarcode className="size-5" aria-hidden />
        Abrir separação
      </NavLink>
    </nav>
  );
}

function Rodape() {
  const { perfil, sair } = useAuth();
  if (!perfil) return null;
  return (
    <div className="flex items-center gap-3 border-t border-white/10 pt-4">
      <Iniciais nome={perfil.nome} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{perfil.nome}</p>
        <p className="text-xs text-white/60">Supervisor</p>
      </div>
      <button
        type="button"
        onClick={sair}
        className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label="Sair"
        title="Sair"
      >
        <LogOut className="size-5" />
      </button>
    </div>
  );
}

export function LayoutSupervisor() {
  const [menuAberto, setMenuAberto] = useState(false);
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Barra lateral (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy px-4 py-6 lg:flex">
        <div className="mb-8 px-2">
          <Logo variante="negativo" className="h-8" />
          <p className="mt-2 text-xs font-medium tracking-[0.18em] text-white/50 uppercase">WMS · Logística</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Navegacao />
        </div>
        <Rodape />
      </aside>

      {/* Topo (celular/tablet) */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between bg-navy px-4 lg:hidden">
        <Logo variante="negativo" className="h-6" />
        <button
          type="button"
          onClick={() => setMenuAberto(true)}
          className="rounded-lg p-2 text-white hover:bg-white/10"
          aria-label="Abrir menu"
        >
          <Menu className="size-6" />
        </button>
      </header>
      {menuAberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-navy/60"
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-navy px-4 py-5">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo variante="negativo" className="h-7" />
              <button
                type="button"
                onClick={() => setMenuAberto(false)}
                className="rounded-lg p-2 text-white hover:bg-white/10"
                aria-label="Fechar menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <Navegacao aoNavegar={() => setMenuAberto(false)} />
            </div>
            <Rodape />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
