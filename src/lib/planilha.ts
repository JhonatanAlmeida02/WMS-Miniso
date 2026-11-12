import readXlsxFile, { readSheetNames } from "read-excel-file/browser";

/** Uma linha da planilha de remessa, já normalizada. */
export interface LinhaRemessa {
  pedido: string;
  loja: string;
  gtin: string;
  produto: string;
  qtd: number;
}

export interface ResultadoLeitura {
  linhas: LinhaRemessa[];
  erros: string[];
  colunas: Record<keyof LinhaRemessa, string>;
  /** Código da remessa lido da coluna NomeRemessa (se houver e for um só). */
  remessa: string | null;
  /** Todos os códigos de remessa diferentes encontrados na coluna. */
  remessas: string[];
  /** Aba onde a tabela foi encontrada. */
  aba: string | null;
}

// Coluna opcional com o código da remessa (a planilha do Power Apps tem NomeRemessa)
const ALIASES_REMESSA = ["nomeremessa", "remessa", "codigoremessa", "codremessa", "numeroremessa"];

// Nomes de coluna aceitos (o Power Apps usava NomePedido, Loja, Gtin, Produto, Qtdped)
const ALIASES: Record<keyof LinhaRemessa, string[]> = {
  pedido: ["nomepedido", "pedido", "numeropedido", "nrpedido", "idpedido"],
  loja: ["loja", "nomeloja", "filial", "destino"],
  gtin: ["gtin", "ean", "codbar", "codigodebarras", "codigobarras", "codbarras"],
  produto: ["produto", "nomeproduto", "descricao", "descricaoproduto", "item"],
  qtd: ["qtdped", "qtd", "quantidade", "qtdpedido", "qtde", "quant"],
};

const normalizar = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function texto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function acharCabecalho(linha: unknown[]) {
  const nomes = linha.map(normalizar);
  const idx = {} as Record<keyof LinhaRemessa, number>;
  for (const campo of Object.keys(ALIASES) as (keyof LinhaRemessa)[]) {
    idx[campo] = nomes.findIndex((n) => ALIASES[campo].includes(n));
  }
  return idx;
}

/** CSV simples (separador ; ou ,) com aspas. */
function lerCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

export const MODELO_CSV =
  "NomePedido;Loja;Gtin;Produto;Qtdped\n" +
  "PED-001;Loja Centro;7891234567890;Produto exemplo 500g;12\n" +
  "PED-002;Loja Norte;7891234567890;Produto exemplo 500g;6\n";

export async function lerPlanilhaRemessa(arquivo: File): Promise<ResultadoLeitura> {
  const ehCsv = /\.csv$/i.test(arquivo.name) || arquivo.type === "text/csv";

  // Procura a tabela em todas as abas (a remessa pode não estar na primeira).
  // O cabeçalho também pode não estar na primeira linha (título, logo etc.).
  const abas: { nome: string | null; ler: () => Promise<unknown[][]> }[] = ehCsv
    ? [{ nome: null, ler: async () => lerCsv((await arquivo.text()).replace(/^\uFEFF/, "")) }]
    : (await readSheetNames(arquivo)).map((nome) => ({
        nome,
        ler: async () => (await readXlsxFile(arquivo, { sheet: nome })) as unknown[][],
      }));

  let linhasBrutas: unknown[][] = [];
  let aba: string | null = null;
  let inicio = -1;
  let idx = {} as Record<keyof LinhaRemessa, number>;
  for (const a of abas) {
    const conteudo = await a.ler();
    for (let i = 0; i < Math.min(conteudo.length, 30); i++) {
      const tentativa = acharCabecalho(conteudo[i]);
      if (Object.values(tentativa).every((v) => v >= 0)) {
        linhasBrutas = conteudo;
        aba = a.nome;
        inicio = i;
        idx = tentativa;
        break;
      }
    }
    if (inicio >= 0) break;
  }
  if (inicio < 0) {
    throw new Error(
      "Não encontrei o cabeçalho. A planilha precisa das colunas: NomePedido, Loja, Gtin, Produto e Qtdped.",
    );
  }

  const cab = linhasBrutas[inicio];
  const colunas = Object.fromEntries(
    (Object.keys(idx) as (keyof LinhaRemessa)[]).map((k) => [k, texto(cab[idx[k]])]),
  ) as Record<keyof LinhaRemessa, string>;

  const idxRemessa = cab.map(normalizar).findIndex((n) => ALIASES_REMESSA.includes(n));
  const codigosRemessa = new Set<string>();

  const linhas: LinhaRemessa[] = [];
  const erros: string[] = [];
  linhasBrutas.slice(inicio + 1).forEach((l, i) => {
    const numLinha = inicio + i + 2; // número da linha no Excel
    const bruto = {
      pedido: texto(l[idx.pedido]),
      loja: texto(l[idx.loja]),
      gtin: texto(l[idx.gtin]).replace(/\s/g, ""),
      produto: texto(l[idx.produto]),
      qtd: texto(l[idx.qtd]),
    };
    if (Object.values(bruto).every((v) => v === "")) return; // linha vazia
    if (idxRemessa >= 0 && texto(l[idxRemessa])) codigosRemessa.add(texto(l[idxRemessa]));

    const qtd = Number(bruto.qtd.replace(",", "."));
    const faltando = (["pedido", "loja", "gtin", "produto"] as const).filter((k) => !bruto[k]);
    if (faltando.length) {
      erros.push(`Linha ${numLinha}: falta ${faltando.join(", ")}`);
      return;
    }
    if (!/^[0-9A-Za-z-]{1,40}$/.test(bruto.gtin)) {
      erros.push(`Linha ${numLinha}: GTIN inválido (${bruto.gtin})`);
      return;
    }
    if (!Number.isInteger(qtd) || qtd <= 0) {
      erros.push(`Linha ${numLinha}: quantidade inválida (${bruto.qtd || "vazia"})`);
      return;
    }
    linhas.push({ ...bruto, qtd });
  });

  // Mesmo pedido em duas lojas é erro de planilha
  const lojaDoPedido = new Map<string, string>();
  for (const l of linhas) {
    const atual = lojaDoPedido.get(l.pedido);
    if (atual && atual.toLowerCase() !== l.loja.toLowerCase()) {
      erros.push(`Pedido ${l.pedido} aparece nas lojas "${atual}" e "${l.loja}"`);
      lojaDoPedido.set(l.pedido, l.loja); // evita repetir
    } else lojaDoPedido.set(l.pedido, l.loja);
  }

  const remessas = [...codigosRemessa];
  return {
    linhas,
    erros: [...new Set(erros)],
    colunas,
    remessa: remessas.length === 1 ? remessas[0] : null,
    remessas,
    aba,
  };
}
