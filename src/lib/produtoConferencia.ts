import type { LinhaConfronto } from "./tipos";

/** O resumo também pode conter ocorrências antigas de itens estranhos ao pedido. */
export function produtoDaConferencia(linhas: Pick<LinhaConfronto, "gtin" | "situacao" | "qtd_pedido">[], codigo: string) {
  const gtin = codigo.replace(/\s/g, "");
  return linhas.some(l => l.gtin === gtin && l.qtd_pedido > 0 && l.situacao !== "fora_do_pedido");
}
