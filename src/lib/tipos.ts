export type Papel = "supervisor" | "operador";
export type StatusRemessa = "pendente" | "ativa" | "concluida";
export type TipoBip = "entrada" | "ajuste";

export interface Perfil {
  id: string;
  login: string;
  nome: string;
  papel: Papel;
  cargo: string | null;
  ativo: boolean;
  ultima_atividade: string | null;
  criado_em: string;
}

export interface Loja {
  id: number;
  numero: number | null;
  nome: string;
}

export interface Remessa {
  id: number;
  codigo: string;
  status: StatusRemessa;
  data_chegada: string | null;
  total_caixas: number | null;
  observacao: string | null;
  arquivo_nome: string | null;
  criado_em: string;
  ativada_em: string | null;
  concluida_em: string | null;
  criado_por_nome: string | null;
  pedidos: number;
  pedidos_sem_operador: number;
  lojas: number;
  itens: number;
  qtd_pedido: number;
  qtd_separada: number;
}

export interface PedidoResumo {
  id: number;
  remessa_id: number;
  remessa_codigo: string;
  remessa_status: StatusRemessa;
  nome: string;
  loja_id: number;
  loja_nome: string;
  loja_numero: number | null;
  operador_id: string | null;
  operador_nome: string | null;
  itens: number;
  qtd_pedido: number;
  qtd_separada: number;
  itens_completos: number;
}

export interface ItemPedido {
  id: number;
  pedido_id: number;
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_separada: number;
}

export interface ItemDoGtin {
  item_id: number;
  pedido_id: number;
  pedido_nome: string;
  remessa_id: number;
  remessa_codigo: string;
  loja_id: number;
  loja_nome: string;
  loja_numero: number | null;
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_separada: number;
  alvo: boolean;
}

export interface Bip {
  id: number;
  item_id: number;
  pedido_id: number;
  remessa_id: number;
  loja_id: number;
  operador_id: string | null;
  gtin: string;
  qtd: number;
  tipo: TipoBip;
  criado_em: string;
  remessa_codigo: string;
  pedido_nome: string;
  loja_nome: string;
  loja_numero: number | null;
  operador_nome: string | null;
  produto: string;
}
