import { mensagemErro } from "./supabase";

/**
 * O Supabase devolve no máximo 1.000 linhas por consulta; isto busca em
 * páginas até acabar (remessas grandes passam fácil disso).
 */
export async function buscarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanho = 1000,
): Promise<{ data: T[] | null; error: unknown }> {
  const tudo: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) return { data: null, error: new Error(mensagemErro(error)) };
    tudo.push(...(data ?? []));
    if (!data || data.length < tamanho) break;
  }
  return { data: tudo, error: null };
}

export function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}
