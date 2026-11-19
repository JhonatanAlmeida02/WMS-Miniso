import { lerConfiguracaoEtiqueta, textoVolume, validarEtiqueta, type ConfiguracaoEtiqueta, type ItemCaixa } from "./caixaTemporaria";

export interface EtiquetaCaixa {
  volume: number;
  ultima: boolean;
  loja: string;
  pedido: string;
  conferencia: number;
  itens: ItemCaixa[];
}

export function criarEtiquetaCaixa(dados: EtiquetaCaixa, doc: Document) {
  if (!dados.itens.length || dados.itens.some(i => !Number.isSafeInteger(i.qtd) || i.qtd <= 0)) throw new Error("A caixa precisa ter itens válidos para imprimir.");
  const root = doc.createElement("section");
  root.id = "wms-etiqueta-caixa";
  const add = (pai: HTMLElement, tag: string, texto: string) => { const e = doc.createElement(tag); e.textContent = texto; pai.append(e); return e; };
  const table = doc.createElement("table"), head = table.createTHead();
  const titulo = doc.createElement("th"); titulo.colSpan = 3;
  add(titulo, "div", "PRODIGY WMS · CONFERÊNCIA");
  add(titulo, "h1", `Volume ${textoVolume(dados.volume, dados.ultima)}`);
  add(titulo, "p", `Loja ${dados.loja}`);
  add(titulo, "p", `Pedido ${dados.pedido} · Conferência ${dados.conferencia}`);
  add(titulo, "p", `${dados.itens.reduce((s,i) => s+i.qtd,0)} unidade(s) · ${dados.itens.length} SKU(s)`);
  head.insertRow().append(titulo);
  const columns = head.insertRow(); ["SKU", "Descrição", "Qtd."].forEach(t => add(columns, "th", t));
  const body = table.createTBody();
  dados.itens.forEach(i => { const row = body.insertRow(); [i.sku, i.descricao, String(i.qtd)].forEach(t => add(row, "td", t)); });
  root.append(table);
  return root;
}

let emImpressao = false;
let limparAnterior: (() => void) | null = null;

/** Não grava itens nem dispara impressão em effects, reload ou navegação. */
export async function imprimirEtiquetaCaixa(dados: EtiquetaCaixa, config: ConfiguracaoEtiqueta = lerConfiguracaoEtiqueta()) {
  const erro = validarEtiqueta(config);
  if (erro) throw new Error(erro);
  if (emImpressao) throw new Error("Aguarde a solicitação de impressão em andamento.");
  emImpressao = true;
  let limpar = () => {};
  try {
    limparAnterior?.();
    const root = criarEtiquetaCaixa(dados, document), estilo = document.createElement("style");
    const [w,h] = config.orientacao === "paisagem" ? [config.altura,config.largura] : [config.largura,config.altura];
    estilo.textContent = `#wms-etiqueta-caixa{display:none}@media print{@page{size:${w}mm ${h}mm;margin:${config.margem}mm}html,body{margin:0!important;padding:0!important;background:white!important}body>*:not(#wms-etiqueta-caixa){display:none!important}#wms-etiqueta-caixa{display:block!important;font:8pt Arial,sans-serif;color:black;width:100%}#wms-etiqueta-caixa table{border-collapse:collapse;width:100%;table-layout:fixed}#wms-etiqueta-caixa thead{display:table-header-group}#wms-etiqueta-caixa tr{break-inside:avoid}#wms-etiqueta-caixa th,#wms-etiqueta-caixa td{border-bottom:0.2mm solid #888;padding:1mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}#wms-etiqueta-caixa th:first-child:not([colspan]),#wms-etiqueta-caixa td:first-child{width:27%}#wms-etiqueta-caixa th:last-child:not([colspan]),#wms-etiqueta-caixa td:last-child{width:13%;text-align:right}#wms-etiqueta-caixa h1{font-size:20pt;margin:2mm 0}#wms-etiqueta-caixa p{margin:1mm 0}}`;
    limpar = () => { root.remove(); estilo.remove(); window.removeEventListener("afterprint", limpar); if (limparAnterior === limpar) limparAnterior = null; };
    limparAnterior = limpar;
    document.head.append(estilo); document.body.append(root);
    window.addEventListener("afterprint", limpar, { once: true });
    await document.fonts?.ready;
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    window.print();
  } catch (error) { limpar(); throw error; }
  finally { emImpressao = false; }
}
