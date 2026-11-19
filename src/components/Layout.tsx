import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import {
  ChartColumn,
  ChevronDown,
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
  UserCog,
  Users,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { ROTULO_PAPEL, ehAdministrador, ehGestor, ehVisualizador, telaInicial } from "../lib/papeis";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { nomeLoja } from "../lib/formato";
import type { Loja } from "../lib/tipos";
import { Logo } from "./Logo";
import { SeloLoja } from "./SeloLoja";
import { Carregando, cx } from "./ui";

interface ItemMenu {
  para: string;
  texto: string;
  icone: LucideIcon;
  /** Itens seguidos com o mesmo grupo viram uma sanfona. */
  grupo?: string;
}

const MENU: ItemMenu[] = [
  { para: "/painel", texto: "Painel", icone: LayoutDashboard, grupo: "Acompanhamento" },
  { para: "/estatisticas", texto: "Estatísticas", icone: ChartColumn, grupo: "Acompanhamento" },
  { para: "/bips", texto: "Log de bips", icone: History, grupo: "Acompanhamento" },
  { para: "/remessas", texto: "Remessas", icone: PackagePlus, grupo: "Operação" },
  { para: "/distribuicao", texto: "Distribuição", icone: Waypoints, grupo: "Operação" },
  { para: "/conferencia", texto: "Conferência", icone: ClipboardCheck, grupo: "Operação" },
  { para: "/usuarios", texto: "Usuários", icone: Users, grupo: "Cadastros" },
  { para: "/lojas", texto: "Lojas", icone: Store, grupo: "Cadastros" },
  // Módulo das lojas: área separada, no fim do menu
  { para: "/lojas-miniso", texto: "Lojas MINISO", icone: Truck },
];

/** Cadastros (usuários e lojas) só para owner e administrador. */
function menuInterno(admin: boolean): ItemMenu[] {
  return admin ? MENU : MENU.filter((i) => i.grupo !== "Cadastros");
}

const MENU_VISUALIZADOR: ItemMenu[] = [{ para: "/visao", texto: "Visão da rede", icone: LayoutDashboard }];

/** Menu da loja; a Equipe aparece só para o administrador da loja. */
export function menuLoja(admin: boolean): ItemMenu[] {
  return [
    { para: "/loja", texto: "Painel da loja", icone: LayoutDashboard },
    { para: "/loja/entregas", texto: "Entregas", icone: Truck },
    ...(admin ? [{ para: "/loja/equipe", texto: "Equipe da loja", icone: UserCog }] : []),
  ];
}

const CHAVE_GRUPOS = "wms.menuGrupos";
function lerGruposAbertos(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) ?? "null") ?? ["Acompanhamento", "Operação"];
  } catch {
    return ["Acompanhamento", "Operação"];
  }
}

/** Junta itens seguidos do mesmo grupo; item sem grupo fica sozinho. */
function agrupar(menu: ItemMenu[]) {
  const blocos: { grupo?: string; itens: ItemMenu[] }[] = [];
  for (const item of menu) {
    const ultimo = blocos[blocos.length - 1];
    if (item.grupo && ultimo?.grupo === item.grupo) ultimo.itens.push(item);
    else blocos.push({ grupo: item.grupo, itens: [item] });
  }
  return blocos;
}

const rotaAtiva = (caminho: string, para: string) => caminho === para || caminho.startsWith(`${para}/`);

/**
 * Exige login e leva cada perfil só às telas dele:
 *   supervisor   -> owner, administrador ou supervisor
 *   admin        -> owner ou administrador
 *   visualizador -> só o visualizador (e ele não entra em nenhuma outra)
 *   loja         -> usuário de loja (e a equipe interna não entra nelas)
 *   adminLoja    -> só o administrador da loja (o conferente fica no início dele)
 * O banco faz a mesma separação; isto aqui só leva cada um para a tela certa.
 */
export function Protegido({
  supervisor,
  admin,
  visualizador,
  loja,
  adminLoja,
  children,
}: {
  supervisor?: boolean;
  admin?: boolean;
  visualizador?: boolean;
  loja?: boolean;
  adminLoja?: boolean;
  children: ReactNode;
}) {
  const { carregando, sessao, perfil } = useAuth();
  const local = useLocation();
  if (carregando) return <Carregando />;
  if (!sessao || !perfil) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  const deLoja = perfil.loja_id != null;
  if (deLoja && !loja) return <Navigate to={telaInicial(perfil)} replace />;
  if (loja && !deLoja) return <Navigate to="/" replace />;
  if (adminLoja && !perfil.admin_loja) return <Navigate to="/loja/inicio" replace />;
  const vis = ehVisualizador(perfil);
  if (vis && !visualizador) return <Navigate to="/visao" replace />;
  if (visualizador && !vis) return <Navigate to="/" replace />;
  if (supervisor && !ehGestor(perfil)) return <Navigate to="/inicio" replace />;
  if (admin && !ehAdministrador(perfil)) return <Navigate to="/painel" replace />;
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
  const { pathname } = useLocation();
  const [abertos, setAbertos] = useState<string[]>(lerGruposAbertos);
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(abertos));
    } catch {
      /* sem armazenamento */
    }
  }, [abertos]);

  const link = ({ para, texto, icone: Icone }: ItemMenu) => (
        <NavLink
          key={para}
          to={para}
          end={para === "/loja"}
          onClick={aoNavegar}
          title={recolhido ? texto : undefined}
          className={({ isActive }) =>
            cx(
              "relative flex items-center gap-3 rounded-xl text-[15px] whitespace-nowrap transition-colors",
              recolhido ? "h-10" : "h-11",
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
  );

  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {agrupar(menu).map((bloco, i) => {
        // Sem grupo, com um item só, ou menu recolhido (só ícones): itens soltos
        if (!bloco.grupo || bloco.itens.length === 1 || recolhido) {
          return (
            <div key={bloco.grupo ?? bloco.itens[0].para} className={cx("flex flex-col gap-1", recolhido && i > 0 && "mt-1.5 border-t border-white/10 pt-1.5")}>
              {bloco.itens.map(link)}
            </div>
          );
        }
        const grupo = bloco.grupo;
        const temAtivo = bloco.itens.some((it) => rotaAtiva(pathname, it.para));
        const aberto = temAtivo || abertos.includes(grupo);
        const id = `grupo-${grupo.normalize("NFD").replace(/[^a-zA-Z]/g, "")}`;
        return (
          <div key={grupo} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setAbertos((a) => (a.includes(grupo) ? a.filter((g) => g !== grupo) : [...a, grupo]))}
              aria-expanded={aberto}
              aria-controls={id}
              disabled={temAtivo}
              className="mt-1 flex h-9 items-center justify-between rounded-lg px-3 text-xs font-semibold tracking-[0.14em] whitespace-nowrap text-white/50 uppercase hover:text-white disabled:cursor-default disabled:hover:text-white/50"
            >
              {grupo}
              <ChevronDown className={cx("size-4 transition-transform duration-200", aberto && "rotate-180")} aria-hidden />
            </button>
            {aberto && (
              <div id={id} className="flex flex-col gap-1">
                {bloco.itens.map(link)}
              </div>
            )}
          </div>
        );
      })}
      {atalhoSeparacao && (
        <>
      <div className={cx("h-px bg-white/10", recolhido ? "my-2" : "my-3")} />
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

/** Mesma estrutura do supervisor, com o menu e o nome da loja. */
export function LayoutLoja() {
  const { perfil } = useAuth();
  const loja = useConsulta<Loja>(
    () => supabase.from("lojas").select("*").eq("id", perfil?.loja_id ?? -1).maybeSingle(),
    [perfil?.loja_id],
  );
  const nome = loja.dados ? nomeLoja(loja.dados.nome, loja.dados.numero) : null;
  return (
    <LayoutSupervisor
      menu={menuLoja(!!perfil?.admin_loja)}
      papel={nome ? `${perfil?.admin_loja ? "Administrador" : "Conferente"} · ${nome}` : perfil?.admin_loja ? "Administrador da loja" : "Conferente da loja"}
      atalhoSeparacao={false}
      identificacao={
        !loja.carregando && !loja.dados ? (
          <div className="mb-6 rounded-2xl bg-amarelo-claro px-4 py-3 text-sm text-[#7a5200] ring-1 ring-amarelo/40" role="alert">
            <p className="font-semibold">O acesso da sua loja ainda não foi liberado</p>
            <p>Enquanto a PRODIGY não liberar a loja, os pedidos e as entregas não aparecem aqui. Fale com a PRODIGY.</p>
          </div>
        ) : loja.dados ? (
          <div className="mb-6 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-borda">
            <SeloLoja numero={loja.dados.numero} nome={loja.dados.nome} className="size-10 text-base" />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.14em] text-suave uppercase">Sua loja</p>
              <p className="truncate text-lg leading-tight font-semibold">{nome}</p>
            </div>
          </div>
        ) : null
      }
      tituloCelular={nome ?? undefined}
    />
  );
}

/** Visualizador: só leitura, sem atalho para a separação. */
export function LayoutVisualizador() {
  const { perfil } = useAuth();
  const escopo = perfil?.escopo_visualizador === "global_miniso" ? "Global MINISO" : "Por loja";
  return <LayoutSupervisor menu={MENU_VISUALIZADOR} papel={`Visualizador · ${escopo}`} atalhoSeparacao={false} />;
}

export function LayoutSupervisor({
  menu: menuPedido,
  papel: papelPedido,
  atalhoSeparacao = true,
  identificacao,
  tituloCelular,
}: { menu?: ItemMenu[]; papel?: string; atalhoSeparacao?: boolean; identificacao?: ReactNode; tituloCelular?: string } = {}) {
  const { perfil } = useAuth();
  const menu = menuPedido ?? menuInterno(ehAdministrador(perfil));
  const papel = papelPedido ?? (perfil ? ROTULO_PAPEL[perfil.papel] : "Supervisor");
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
        <div className={cx("flex h-12 flex-col justify-center", recolhido ? "mb-5 items-center" : "mb-8 px-2")}>
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
        <div className="flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Navegacao recolhido={recolhido} menu={menu} atalhoSeparacao={atalhoSeparacao} />
        </div>
        <Rodape recolhido={recolhido} papel={papel} />
      </aside>

      {/* Topo (celular/tablet) */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between bg-navy px-4 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Logo variante="negativo" className="h-6" />
          {tituloCelular && <span className="truncate text-sm font-semibold text-white">Loja {tituloCelular}</span>}
        </div>
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
            <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Navegacao aoNavegar={() => setMenuAberto(false)} menu={menu} atalhoSeparacao={atalhoSeparacao} />
            </div>
            <Rodape papel={papel} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {identificacao}
        <Outlet />
      </main>
    </div>
  );
}
