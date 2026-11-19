import type { EscopoVisualizador, Papel, Perfil } from "./tipos";

/**
 * Perfis da PRODIGY (docs/PERFIS_E_PERMISSOES.md). As telas só escondem o que
 * cada um não usa; quem garante a permissão é o banco e as funções do servidor.
 */
export const ROTULO_PAPEL: Record<Papel, string> = {
  owner: "Owner",
  administrador: "Administrador",
  supervisor: "Supervisor",
  operador: "Operador",
  visualizador: "Visualizador",
};

export const ROTULO_ESCOPO: Record<EscopoVisualizador, string> = {
  lojas: "Por loja",
  global_miniso: "Global MINISO",
};

type P = Pick<Perfil, "papel" | "loja_id" | "admin_loja"> | null | undefined;
const interno = (p: P) => !!p && p.loja_id == null;

/** Owner, administrador ou supervisor: coordena a operação. */
export const ehGestor = (p: P) => interno(p) && ["owner", "administrador", "supervisor"].includes(p!.papel);
/** Owner ou administrador: configurações, cadastro de lojas e acessos. */
export const ehAdministrador = (p: P) => interno(p) && ["owner", "administrador"].includes(p!.papel);
export const ehOwner = (p: P) => interno(p) && p!.papel === "owner";
export const ehVisualizador = (p: P) => interno(p) && p!.papel === "visualizador";

/** Tela inicial de cada perfil. */
export function telaInicial(p: P) {
  if (!p) return "/login";
  // Loja: o administrador fica no painel; o conferente vai direto para conferir
  if (p.loja_id != null) return p.admin_loja ? "/loja" : "/loja/inicio";
  if (ehVisualizador(p)) return "/visao";
  return ehGestor(p) ? "/painel" : "/inicio";
}

/** Perfis que o usuário logado pode dar a alguém. */
export function papeisQueConcede(p: P): Papel[] {
  if (ehOwner(p)) return ["administrador", "supervisor", "operador", "visualizador"];
  if (ehAdministrador(p)) return ["supervisor", "operador", "visualizador"];
  return [];
}
