import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCheck, ClipboardCheck, Download, Shuffle, TriangleAlert } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { baixarCsv } from "../lib/buscarTudo";
import { fmtDataHora, fmtNum } from "../lib/formato";
import type { ConferenciaLoja, LinhaConfronto, Perfil, Remessa } from "../lib/tipos";
import { Confronto } from "./Confronto";
import { SeloLoja } from "./SeloLoja";
import { Botao, Cartao, Carregando, Modal, Selo, Vazio, cx } from "./ui";

function duracao(inicio: string | null, fim: string | null) {
  if (!inicio || !fim) return "—";
  const min = Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function SituacaoSelo({ l }: { l: ConferenciaLoja }) {
  if (!l.status) return <Selo className="bg-navy/8 text-suave">Não conferida</Selo>;
  if (l.status === "em_andamento") return <Selo className="bg-azul-claro text-azul-escuro">Em conferência</Selo>;
  return l.divergencias ? (
    <Selo className="bg-erro-claro text-erro">
      {l.divergencias} {l.divergencias === 1 ? "divergência" : "divergências"}
    </Selo>
  ) : (
    <Selo className="bg-ciano-claro text-ciano-escuro">
      <CheckCheck className="size-3.5" /> OK
    </Selo>
  );
}

/** Aba "Conferência física" do supervisor: situação de cada loja e o confronto. */
export function ConferenciaFisica({ remessa }: { remessa: Remessa }) {
  const lojas = useConsulta<ConferenciaLoja[]>(
    () =>
      supabase
        .from("v_conferencia_lojas")
        .select("*")
        .eq("remessa_id", remessa.id)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome"),
    [remessa.id],
    { tabelas: ["conferencias", "pedidos"] },
  );
  const usuarios = useConsulta<Perfil[]>(() => supabase.from("perfis").select("*").eq("ativo", true).order("nome"), []);
  const equipe = usuarios.dados ?? [];
  const [salvando, setSalvando] = useState<number | "todos" | null>(null);

  async function atribuir(atrib: { pedido_id: number; conferente_id: string | null }[]) {
    const { error } = await supabase.rpc("atribuir_conferentes", { p_atribuicoes: atrib });
    if (error) {
      toast.error(mensagemErro(error));
      return false;
    }
    lojas.recarregar();
    return true;
  }

  /** Divide as lojas sem conferente entre os operadores, equilibrando as unidades
   *  e evitando que alguém confira a loja que ele mesmo separou. */
  async function dividir() {
    const semConferente = (lojas.dados ?? []).filter((l) => !l.conferente_id && l.status !== "finalizada");
    const operadores = equipe.filter((u) => u.papel === "operador");
    if (!semConferente.length) {
      toast.info("Todas as lojas já têm conferente.");
      return;
    }
    if (!operadores.length) {
      toast.info("Cadastre operadores primeiro.");
      return;
    }
    const carga = new Map(operadores.map((o) => [o.id, 0]));
    for (const l of lista) if (l.conferente_id && carga.has(l.conferente_id)) carga.set(l.conferente_id, (carga.get(l.conferente_id) ?? 0) + l.qtd_separada);
    const atrib: { pedido_id: number; conferente_id: string }[] = [];
    for (const l of [...semConferente].sort((a, b) => b.qtd_separada - a.qtd_separada)) {
      const candidatos = [...carga.entries()].sort((a, b) => a[1] - b[1]);
      const escolhido = candidatos.find(([id]) => id !== l.operador_id) ?? candidatos[0];
      atrib.push({ pedido_id: l.pedido_id, conferente_id: escolhido[0] });
      carga.set(escolhido[0], escolhido[1] + l.qtd_separada);
    }
    setSalvando("todos");
    const ok = await atribuir(atrib);
    setSalvando(null);
    if (ok) toast.success(`${atrib.length} lojas atribuídas para conferência`);
  }
  const [aberta, setAberta] = useState<ConferenciaLoja | null>(null);
  const [linhas, setLinhas] = useState<LinhaConfronto[] | null>(null);

  // Conferências em andamento: atualiza o progresso a cada 15 s
  const recarregar = lojas.recarregar;
  const temAndamento = (lojas.dados ?? []).some((l) => l.status === "em_andamento");
  useEffect(() => {
    if (!temAndamento) return;
    const t = setInterval(recarregar, 15000);
    return () => clearInterval(t);
  }, [temAndamento, recarregar]);

  useEffect(() => {
    if (!aberta?.conferencia_id) return;
    setLinhas(null);
    supabase.rpc("resumo_conferencia", { p_conferencia: aberta.conferencia_id }).then(({ data }) => setLinhas((data ?? []) as LinhaConfronto[]));
  }, [aberta]);

  const lista = lojas.dados ?? [];
  const finalizadas = lista.filter((l) => l.status === "finalizada");
  const comDivergencia = finalizadas.filter((l) => l.divergencias);
  const andamento = lista.filter((l) => l.status === "em_andamento").length;

  async function exportar() {
    const linhasCsv: (string | number | null)[][] = [
      ["Loja", "Pedido", "Situação", "GTIN", "Produto", "Pedido (un.)", "Separado (un.)", "Conferido (un.)", "Diferença"],
    ];
    for (const l of lista.filter((x) => x.conferencia_id)) {
      const { data } = await supabase.rpc("resumo_conferencia", { p_conferencia: l.conferencia_id });
      for (const r of (data ?? []) as LinhaConfronto[]) {
        if (r.situacao === "ok") continue;
        linhasCsv.push([l.loja_nome, l.pedido_nome, r.situacao, r.gtin, r.produto, r.qtd_pedido, r.qtd_separada, r.qtd_conferida, r.qtd_conferida - r.qtd_separada]);
      }
    }
    baixarCsv(`conferencia-fisica-${remessa.codigo}.csv`, linhasCsv);
  }

  if (lojas.carregando && !lojas.dados) return <Carregando />;

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao className="p-4">
          <p className="text-xs text-suave">Lojas conferidas</p>
          <p className="tabular text-2xl font-semibold">
            {finalizadas.length}
            <span className="text-base font-normal text-suave">/{lista.length}</span>
          </p>
        </Cartao>
        <Cartao className="p-4">
          <p className="text-xs text-suave">Conferidas OK</p>
          <p className="tabular text-2xl font-semibold text-ciano-escuro">{finalizadas.length - comDivergencia.length}</p>
        </Cartao>
        <Cartao className="p-4">
          <p className="text-xs text-suave">Com divergência</p>
          <p className={cx("tabular text-2xl font-semibold", comDivergencia.length > 0 && "text-erro")}>{comDivergencia.length}</p>
        </Cartao>
        <Cartao className="p-4">
          <p className="text-xs text-suave">Em conferência agora</p>
          <p className="tabular text-2xl font-semibold">{andamento}</p>
        </Cartao>
      </div>

      <Cartao className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda px-5 py-3">
          <div>
            <h2 className="font-semibold">Lojas</h2>
            <p className="text-xs text-suave">Escolha quem confere cada loja. O operador só vê as lojas atribuídas a ele.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Botao variante="secundario" tamanho="sm" icone={<Shuffle className="size-4" />} onClick={dividir} carregando={salvando === "todos"}>
              Dividir automaticamente
            </Botao>
            <Botao variante="secundario" tamanho="sm" icone={<Download className="size-4" />} onClick={exportar} disabled={!lista.some((l) => l.conferencia_id)}>
              Exportar divergências
            </Botao>
          </div>
        </div>
        {lista.length === 0 ? (
          <Vazio icone={<ClipboardCheck className="size-8" />} titulo="Nenhuma loja nesta remessa" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-3 py-3 text-right">Separado</th>
                  <th className="px-3 py-3 text-right">Conferido</th>
                  <th className="px-3 py-3">Conferente</th>
                  <th className="px-3 py-3">Conferido por</th>
                  <th className="px-3 py-3 text-right">Duração</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((l) => (
                  <tr key={l.pedido_id}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-3">
                        <SeloLoja numero={l.loja_numero} nome={l.loja_nome} className="size-8 text-sm" />
                        <span>
                          <span className="font-medium">{l.loja_nome}</span>
                          <span className="block text-xs text-suave">Pedido {l.pedido_nome}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <SituacaoSelo l={l} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(l.qtd_separada)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-semibold">{l.status ? fmtNum(l.qtd_conferida) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <label className="sr-only" htmlFor={`conf-${l.pedido_id}`}>
                        Conferente da loja {l.loja_nome}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <select
                          id={`conf-${l.pedido_id}`}
                          value={l.conferente_id ?? ""}
                          disabled={salvando !== null}
                          onChange={async (e) => {
                            setSalvando(l.pedido_id);
                            const ok = await atribuir([{ pedido_id: l.pedido_id, conferente_id: e.target.value || null }]);
                            setSalvando(null);
                            if (ok) toast.success(`Conferente de ${l.loja_nome} atualizado`);
                          }}
                          className={cx(
                            "h-9 w-full min-w-40 rounded-lg border bg-white px-2 text-sm",
                            l.conferente_id ? "border-borda" : "border-amarelo text-[#7a5200]",
                          )}
                        >
                          <option value="">Sem conferente</option>
                          {equipe.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nome}
                            </option>
                          ))}
                        </select>
                        {l.conferente_id && l.conferente_id === l.operador_id && (
                          <span title="Quem vai conferir é quem separou esta loja" className="text-[#7a5200]">
                            <TriangleAlert className="size-4" aria-label="Mesma pessoa que separou" />
                          </span>
                        )}
                      </div>
                      {l.operador_nome && <span className="block text-xs text-suave">Separou: {l.operador_nome}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.finalizada_por_nome ?? (l.status === "em_andamento" ? <span className="text-azul-escuro">{l.bips} leituras…</span> : "—")}
                      {l.finalizada_em && <span className="block text-xs text-suave">{fmtDataHora(l.finalizada_em)}</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{duracao(l.iniciada_em, l.finalizada_em)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {l.conferencia_id && (
                        <Botao variante="fantasma" tamanho="sm" onClick={() => setAberta(l)}>
                          Ver confronto
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Modal aberto={!!aberta} aoFechar={() => setAberta(null)} titulo={`Confronto · ${aberta?.loja_nome ?? ""}`} largura="max-w-3xl">
        {aberta?.status === "em_andamento" && (
          <p className="mb-3 rounded-xl bg-azul-claro px-3 py-2 text-sm text-azul-escuro">
            Conferência ainda em andamento: os números podem mudar.
          </p>
        )}
        {linhas ? <Confronto linhas={linhas} /> : <Carregando />}
      </Modal>
    </>
  );
}
