import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import {
  ChartColumn,
  ChevronLeft,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  ScanBarcode,
  Store,
  Truck,
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
  { para: "/expedicao", texto: "Expedição", icone: Truck },
  { para: "/bips", texto: "Log de bips", icone: History },
  { para: "/estatisticas", texto: "Estatísticas", icone: ChartColumn },
  { para: "/usuarios", texto: "Usuários", icone: Users },
  { para: "/lojas", texto: "Lojas", icone: Store },
];

/** Menu do administrador da loja (operador com loja vinculada). */
export const MENU_LOJA = [
  { para: "/loja", texto: "Painel da loja", icone: LayoutDashboard },
  { para: "/loja/entregas", texto: "Entregas", icone: Truck },
];

type ItemMenu = (typeof MENU)[number];

/**
 * Exige login (e, se pedido, perfil de supervisor). Usuário de loja só entra
 * nas telas da loja (loja), e a equipe interna não entra nelas. O banco faz a
 * mesma separação; isto aqui só leva cada um para a tela certa.
 */
export function Protegido({ supervisor, loja, children }: { supervisor?: boolean; loja?: boolean; children: ReactNode }) {
  const { carregando, sessao, perfil } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao || !perfil) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  const deLoja = perfil.loja_id != null;
  if (deLoja && !loja) return <Navigate to="/loja" replace />;
  if (loja && !deLoja) return <Navigate to="/" replace />;
  if (supervisor && perfil.papel !== "supervisor") return <Navigate to="/inicio" replace />;
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

function Navegacao({
  aoNavegar,
  recolhido = false,
  menu = MENU,
  atalhoSeparacao = true,
}: {
  aoNavegar?: () => void;
  recolhido?: boolean;
  menu?: ItemMenu[];
  atalhoSeparacao?: boolean;
}) {
  // Recolhido: só o ícone; o nome vira dica ao passar o mouse e continua
  // disponível para leitor de tela
  const rotulo = (texto: string) => (recolhido ? <span className="sr-only">{texto}</span> : <span className="truncate">{texto}</span>);
  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {menu.map(({ para, texto, icone: Icone }) => (
        <NavLink
          key={para}
          to={para}
          end={para === "/loja"}
          onClick={aoNavegar}
          title={recolhido ? texto : undefined}
          className={({ isActive }) =>
            cx(
              "relative flex h-11 items-center gap-3 rounded-xl text-[15px] whitespace-nowrap transition-colors",
              recolhido ? "justify-center px-0" : "px-3",
              isActive ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-amarelo" aria-hidden />}
              <Icone className={cx("size-5 shrink-0", isActive ? "text-amarelo" : "")} aria-hidden />
              {rotulo(texto)}
            </>
          )}
        </NavLink>
      ))}
      {atalhoSeparacao && (
        <>
      <div className="my-3 h-px bg-white/10" />
      <NavLink
        to="/separacao"
        onClick={aoNavegar}
        title={recolhido ? "Abrir separação" : undefined}
        className={cx(
          "flex h-11 items-center gap-3 rounded-xl bg-ciano text-[15px] font-medium whitespace-nowrap text-navy hover:bg-[#00b2a3]",
          recolhido ? "justify-center px-0" : "px-3",
        )}
      >
        <ScanBarcode className="size-5 shrink-0" aria-hidden />
        {rotulo("Abrir separação")}
      </NavLink>
        </>
      )}
    </nav>
  );
}

function Rodape({ recolhido = false, papel = "Supervisor" }: { recolhido?: boolean; papel?: string }) {
  const { perfil, sair } = useAuth();
  if (!perfil) return null;
  if (recolhido) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-white/10 pt-4" title={perfil.nome}>
        <Iniciais nome={perfil.nome} />
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
  return (
    <div className="flex items-center gap-3 border-t border-white/10 pt-4">
      <Iniciais nome={perfil.nome} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{perfil.nome}</p>
        <p className="text-xs text-white/60">{papel}</p>
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

const CHAVE_RECOLHIDO = "wms.menuRecolhido";

function lerRecolhido() {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

/** Mesma estrutura do supervisor, com o menu da loja. */
export function LayoutLoja() {
  return <LayoutSupervisor menu={MENU_LOJA} papel="Administrador da loja" atalhoSeparacao={false} />;
}

export function LayoutSupervisor({
  menu = MENU,
  papel = "Supervisor",
  atalhoSeparacao = true,
}: { menu?: ItemMenu[]; papel?: string; atalhoSeparacao?: boolean } = {}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [recolhido, setRecolhido] = useState(lerRecolhido);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_RECOLHIDO, recolhido ? "1" : "0");
    } catch {
      /* sem armazenamento */
    }
  }, [recolhido]);

  return (
    <div className={cx("min-h-dvh transition-[padding] duration-200", recolhido ? "lg:pl-20" : "lg:pl-64")}>
      {/* Barra lateral (desktop): expande e recolhe */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-navy py-6 transition-[width] duration-200 lg:flex",
          recolhido ? "w-20 px-3" : "w-64 px-4",
        )}
      >
        <div className={cx("mb-8 flex h-12 flex-col justify-center", recolhido ? "items-center" : "px-2")}>
          {recolhido ? (
            <Logo variante="negativo" simbolo className="h-8" />
          ) : (
            <>
              <Logo variante="negativo" className="h-8 self-start" />
              <p className="mt-2 text-xs font-medium tracking-[0.18em] whitespace-nowrap text-white/50 uppercase">WMS · Logística</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRecolhido((r) => !r)}
          className="absolute top-8 -right-3.5 grid size-7 place-items-center rounded-full border border-borda bg-white text-navy shadow-md hover:bg-azul-claro"
          aria-label={recolhido ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!recolhido}
          title={recolhido ? "Expandir menu" : "Recolher menu"}
        >
          <ChevronLeft className={cx("size-4 transition-transform duration-200", recolhido && "rotate-180")} />
        </button>
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          <Navegacao recolhido={recolhido} menu={menu} atalhoSeparacao={atalhoSeparacao} />
        </div>
        <Rodape recolhido={recolhido} papel={papel} />
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
              <Navegacao aoNavegar={() => setMenuAberto(false)} menu={menu} atalhoSeparacao={atalhoSeparacao} />
            </div>
            <Rodape papel={papel} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
