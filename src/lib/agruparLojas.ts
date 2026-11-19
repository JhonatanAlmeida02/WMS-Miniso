/** Identidade da loja vem do ID, nunca da descrição: nomes iguais não se misturam. */
export function agruparPorLoja<T extends { loja_id: number; loja_nome: string; loja_numero: number | null }>(linhas: T[]) {
  const grupos = new Map<number, { id: number; nome: string; numero: number | null; linhas: T[] }>();
  for (const linha of linhas) {
    let grupo = grupos.get(linha.loja_id);
    if (!grupo) { grupo = { id: linha.loja_id, nome: linha.loja_nome, numero: linha.loja_numero, linhas: [] }; grupos.set(linha.loja_id, grupo); }
    grupo.linhas.push(linha);
  }
  return [...grupos.values()].sort((a,b) => (a.numero ?? Number.MAX_SAFE_INTEGER) - (b.numero ?? Number.MAX_SAFE_INTEGER) || a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }) || a.id - b.id);
}
