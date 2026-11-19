export type Papel = "owner" | "administrador" | "supervisor" | "operador" | "visualizador";
export type EscopoVisualizador = "lojas" | "global_miniso";
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
  /** Preenchido só para o administrador de loja (operador com acesso à própria loja). */
  loja_id?: number | null;
  /** Usuário de loja: administrador (cadastra a equipe) ou conferente. */
  admin_loja?: boolean;
  /** Só visualizador: lojas atribuídas ou toda a rede MINISO. */
  escopo_visualizador?: EscopoVisualizador | null;
}

export interface Loja {
  id: number;
  numero: number | null;
  nome: string;
  /** Módulo das lojas habilitado (painel e recebimento). */
  modulo_loja?: boolean;
  /** Rede da loja (o escopo Global MINISO cobre a rede MINISO). */
  rede?: string;
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

export type StatusConferencia = "em_andamento" | "finalizada";
export type SituacaoConferencia = "ok" | "falta" | "sobra" | "fora_do_pedido";

/** Situação da conferência física de uma loja (v_conferencia_lojas). */
export interface ConferenciaLoja {
  pedido_id: number;
  remessa_id: number;
  pedido_nome: string;
  loja_nome: string;
  loja_numero: number | null;
  qtd_pedido: number;
  qtd_separada: number;
  conferencia_id: number | null;
  status: StatusConferencia | null;
  iniciada_em: string | null;
  finalizada_em: string | null;
  iniciada_por_nome: string | null;
  finalizada_por_nome: string | null;
  qtd_conferida: number;
  bips: number;
  divergencias: number | null;
  conferente_id: string | null;
  conferente_nome: string | null;
  operador_id: string | null;
  operador_nome: string | null;
}

/** Uma linha do confronto pedido x separado x conferido. */
export interface LinhaConfronto {
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_separada: number;
  qtd_conferida: number;
  situacao: SituacaoConferencia;
}

// ---------------------------------------------------------------------------
// Módulo das lojas: expedição e recebimento
// ---------------------------------------------------------------------------
export type StatusRecebimento = "aguardando" | "em_conferencia" | "recebido_conferido" | "recebido_com_divergencia";
export type TipoDivergencia = "falta" | "sobra" | "avaria" | "inesperado";
export type StatusDivergencia = "aberta" | "em_analise" | "resolvida";
export type SituacaoRecebimento = "ok" | "falta" | "sobra" | "avaria" | "inesperado";

/** Um pedido da loja do começo ao fim (v_loja_pedidos). */
export interface PedidoLoja {
  pedido_id: number;
  pedido_nome: string;
  remessa_id: number;
  remessa_codigo: string;
  remessa_status: StatusRemessa;
  remessa_criada_em: string;
  remessa_ativada_em: string | null;
  data_chegada: string | null;
  loja_id: number;
  loja_nome: string;
  loja_numero: number | null;
  itens: number;
  qtd_pedido: number;
  qtd_separada: number;
  conferencia_cd_status: StatusConferencia | null;
  qtd_conferida_cd: number;
  expedicoes: number;
  volumes_expedidos: number;
  volumes_recebidos: number;
  qtd_expedida: number;
  qtd_recebida: number;
  qtd_avariada: number;
  entregas_aguardando: number;
  entregas_em_conferencia: number;
  entregas_conferidas: number;
  entregas_com_divergencia: number;
  ultima_expedicao_em: string | null;
}

/** Produto do pedido da loja (v_loja_itens). */
export interface ItemLoja {
  item_id: number;
  pedido_id: number;
  loja_id: number;
  remessa_id: number;
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_separada: number;
  qtd_expedida: number;
  qtd_a_receber: number;
  qtd_recebida: number;
  qtd_avariada: number;
}

/** Uma entrega (expedição) e o recebimento dela (v_expedicoes). */
export interface Expedicao {
  id: number;
  pedido_id: number;
  loja_id: number;
  remessa_id: number;
  numero: number;
  volumes: number;
  observacao: string | null;
  expedida_em: string;
  expedida_por_nome: string | null;
  pedido_nome: string;
  remessa_codigo: string;
  loja_nome: string;
  loja_numero: number | null;
  produtos: number;
  qtd_expedida: number;
  recebimento_id: number;
  recebimento_status: StatusRecebimento;
  revisao: number;
  iniciado_em: string | null;
  finalizado_em: string | null;
  finalizado_por_nome: string | null;
  qtd_integra: number;
  qtd_avariada: number;
  leituras: number;
  divergencias: number;
  divergencias_abertas: number;
}

/** Uma linha do confronto do recebimento (resumo_recebimento). */
export interface LinhaRecebimento {
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_expedida: number;
  qtd_integra: number;
  qtd_avariada: number;
  qtd_recebida: number;
  situacao: SituacaoRecebimento;
}

export interface Divergencia {
  id: number;
  recebimento_id: number;
  revisao: number;
  loja_id: number;
  gtin: string;
  produto: string;
  tipo: TipoDivergencia;
  qtd_expedida: number;
  qtd_recebida: number;
  qtd_avariada: number;
  qtd: number;
  status: StatusDivergencia;
  resolucao: string | null;
  resolvida_em: string | null;
  criada_em: string;
  expedicao_id: number;
  expedicao_numero: number;
  pedido_id: number;
  remessa_id: number;
  pedido_nome: string;
  remessa_codigo: string;
  loja_nome: string;
  loja_numero: number | null;
  atual: boolean;
  resolvida_por_nome: string | null;
}
