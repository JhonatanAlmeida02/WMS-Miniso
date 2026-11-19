export interface ItemCaixa { sku: string; descricao: string; qtd: number }

/** Só itens da caixa aberta. Não recebe o total acumulado da conferência. */
export function aplicarLeituraCaixa(itens: ItemCaixa[], item: Omit<ItemCaixa, "qtd">, quantidade: number): ItemCaixa[] {
  if (!Number.isSafeInteger(quantidade) || quantidade === 0) throw new Error("Quantidade inválida.");
  const anterior = itens.find(i => i.sku === item.sku)?.qtd ?? 0;
  const total = anterior + quantidade;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Só é possível desfazer itens da caixa aberta.");
  if (total === 0) return itens.filter(i => i.sku !== item.sku);
  if (!anterior) return [...itens, { ...item, qtd: total }];
  return itens.map(i => i.sku === item.sku ? { ...i, descricao: item.descricao, qtd: total } : i);
}

export function textoVolume(numero: number, ultima: boolean) {
  if (!Number.isSafeInteger(numero) || numero < 1) throw new Error("Número do volume inválido.");
  return ultima ? `${numero}/${numero}` : String(numero);
}

export interface ConfiguracaoEtiqueta { largura: number; altura: number; margem: number; orientacao: "retrato" | "paisagem" }
export const ETIQUETA_PADRAO: ConfiguracaoEtiqueta = { largura: 100, altura: 150, margem: 2, orientacao: "retrato" };
export const CHAVE_ETIQUETA = "wms.etiquetaCaixa.v1";

export function validarEtiqueta(c: ConfiguracaoEtiqueta): string | null {
  if (![c.largura, c.altura, c.margem].every(Number.isFinite)) return "Informe medidas numéricas válidas.";
  if (c.largura < 40 || c.largura > 210 || c.altura < 40 || c.altura > 500) return "Largura: 40 a 210 mm. Altura: 40 a 500 mm.";
  if (c.margem < 0 || c.margem > 15 || Math.min(c.largura, c.altura) - c.margem * 2 < 30) return "Use margens de 0 a 15 mm, deixando pelo menos 30 mm de área útil.";
  if (c.orientacao !== "retrato" && c.orientacao !== "paisagem") return "Orientação inválida.";
  return null;
}

export function lerConfiguracaoEtiqueta(): ConfiguracaoEtiqueta {
  try {
    const raw = localStorage.getItem(CHAVE_ETIQUETA);
    if (raw) {
      const c = JSON.parse(raw) as ConfiguracaoEtiqueta;
      if (c && !validarEtiqueta(c)) return c;
    }
  } catch { /* configuração indisponível ou inválida */ }
  return { ...ETIQUETA_PADRAO };
}

export function salvarConfiguracaoEtiqueta(c: ConfiguracaoEtiqueta) {
  const erro = validarEtiqueta(c);
  if (erro) throw new Error(erro);
  localStorage.setItem(CHAVE_ETIQUETA, JSON.stringify(c));
}
