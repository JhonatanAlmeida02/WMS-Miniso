import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Shuffle, Waypoints } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { ROTULO_PAPEL } from "../lib/papeis";
import { useConsulta } from "../lib/useConsulta";
import { useRemessaEscolhida } from "../lib/useRemessaEscolhida";
import { fmtNum, nomeLoja } from "../lib/formato";
import type { PedidoResumo, Perfil } from "../lib/tipos";
import { Barra, Botao, Cartao, Carregando, SeloStatus, Selecao, Titulo, Vazio, cx } from "../components/ui";

export default function Distribuicao() {
  const { lista: remessas, escolhida, escolher, carregando } = useRemessaEscolhida();
  const [mudancas, setMudancas] = useState<Record<number, string | null>>({});
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [paraOperador, setParaOperador] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Quem entra no "Dividir automaticamente" (desmarque quem não está trabalhando hoje)
  const [fora, setFora] = useState<Set<string>>(new Set());

  const pedidos = useConsulta<PedidoResumo[]>(
    () =>
      supabase
        .from("v_pedidos")
        .select("*")
        .eq("remessa_id", escolhida?.id ?? -1)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome")
        .order("nome"),
    [escolhida?.id],
    { tabelas: ["pedidos", "bips"], ativo: !!escolhida },
  );
  const operadores = useConsulta<Perfil[]>(() => supabase.from("perfis").select("*").eq("ativo", true).neq("papel", "visualizador").order("nome"), []);

  useEffect(() => {
    setMudancas({});
    setSelecionados(new Set());
  }, [escolhida?.id]);

  const lista = pedidos.dados ?? [];
  const ops = operadores.dados ?? [];
  const operadorDe = (p: PedidoResumo) => (p.id in mudancas ? mudancas[p.id] : p.operador_id);
  const pendentes = Object.entries(mudancas).filter(([id, op]) => lista.find((p) => p.id === Number(id))?.operador_id !== op);

  // Carga por operador (unidades), considerando as mudanças não salvas
  const carga = useMemo(() => {
    const m = new Map<string, { un: number; pedidos: number }>();
    for (const p of lista) {
      const op = p.id in mudancas ? mudancas[p.id] : p.operador_id;
      if (!op) continue;
      const c = m.get(op) ?? { un: 0, pedidos: 0 };
      c.un += p.qtd_pedido - p.qtd_separada;
      c.pedidos += 1;
      m.set(op, c);
    }
    return m;
  }, [lista, mudancas]);

  function atribuir(ids: number[], op: string | null) {
    setMudancas((m) => {
      const n = { ...m };
      for (const id of ids) n[id] = op;
      return n;
    });
  }

  /** Divide os selecionados (ou os sem operador) entre os operadores, equilibrando unidades que faltam. */
  function dividir() {
    const alvo = selecionados.size ? lista.filter((p) => selecionados.has(p.id)) : lista.filter((p) => !operadorDe(p));
    const equipe = ops.filter((o) => o.papel === "operador" && !fora.has(o.id));
    if (!alvo.length || !equipe.length) {
      toast.info(
        equipe.length
          ? "Nada para dividir: selecione pedidos ou deixe algum sem operador."
          : "Marque ao lado quais operadores participam da divisão.",
      );
      return;
    }
    const soma = new Map(equipe.map((o) => [o.id, 0]));
    const novos: Record<number, string> = {};
    for (const p of [...alvo].sort((a, b) => b.qtd_pedido - b.qtd_separada - (a.qtd_pedido - a.qtd_separada))) {
      const [menor] = [...soma.entries()].sort((a, b) => a[1] - b[1])[0];
      novos[p.id] = menor;
      soma.set(menor, (soma.get(menor) ?? 0) + p.qtd_pedido - p.qtd_separada);
    }
    setMudancas((m) => ({ ...m, ...novos }));
    toast.success(`${alvo.length} pedidos divididos entre ${equipe.length} operadores. Confira e salve.`);
  }

  async function salvar() {
    if (!pendentes.length) return;
    setSalvando(true);
    const { error } = await supabase.rpc("distribuir_pedidos", {
      p_atribuicoes: pendentes.map(([id, op]) => ({ pedido_id: Number(id), operador_id: op })),
    });
    setSalvando(false);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    toast.success(`Operadores atribuídos em ${pendentes.length} pedidos`);
    setMudancas({});
    setSelecionados(new Set());
    pedidos.recarregar();
  }

  const todosMarcados = lista.length > 0 && selecionados.size === lista.length;

  return (
    <>
      <Titulo
        titulo="Distribuição"
        descricao="Defina qual operador separa cada pedido. Só o operador do pedido consegue bipar nele."
        acoes={
          <Botao icone={<Save className="size-4" />} disabled={!pendentes.length} carregando={salvando} onClick={salvar}>
            Salvar {pendentes.length > 0 && `(${pendentes.length})`}
          </Botao>
        }
      />

      {carregando ? (
        <Carregando />
      ) : remessas.length === 0 ? (
        <Cartao>
          <Vazio icone={<Waypoints className="size-8" />} titulo="Nenhuma remessa aberta">
            Importe uma remessa para distribuir os pedidos.
          </Vazio>
        </Cartao>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-4">
            <Cartao className="flex flex-wrap items-end gap-3 p-4">
              <Selecao
                rotulo="Remessa"
                className="min-w-56 flex-1"
                value={escolhida?.id ?? ""}
                onChange={(e) => escolher(Number(e.target.value))}
              >
                {remessas.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.codigo} · {r.status === "ativa" ? "ativa" : "pendente"} · {r.pedidos} pedidos
                  </option>
                ))}
              </Selecao>
              {escolhida && <SeloStatus status={escolhida.status} />}
            </Cartao>

            <Cartao className="flex flex-wrap items-end gap-3 p-4">
              <Selecao
                rotulo={selecionados.size ? `Atribuir ${selecionados.size} selecionados a` : "Atribuir selecionados a"}
                className="min-w-56 flex-1"
                value={paraOperador}
                onChange={(e) => setParaOperador(e.target.value)}
              >
                <option value="">Escolha o operador…</option>
                {ops.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
                <option value="__nenhum">— Tirar operador</option>
              </Selecao>
              <Botao
                variante="secundario"
                disabled={!selecionados.size || !paraOperador}
                onClick={() => {
                  atribuir([...selecionados], paraOperador === "__nenhum" ? null : paraOperador);
                  setSelecionados(new Set());
                }}
              >
                Aplicar
              </Botao>
              <Botao variante="secundario" icone={<Shuffle className="size-4" />} onClick={dividir}>
                Dividir automaticamente
              </Botao>
            </Cartao>

            <Cartao className="overflow-hidden">
              {!pedidos.dados ? (
                <Carregando />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                      <tr>
                        <th className="w-12 px-4 py-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-azul"
                            aria-label="Selecionar todos"
                            checked={todosMarcados}
                            onChange={() => setSelecionados(todosMarcados ? new Set() : new Set(lista.map((p) => p.id)))}
                          />
                        </th>
                        <th className="px-3 py-3">Loja</th>
                        <th className="px-3 py-3">Pedido</th>
                        <th className="px-3 py-3 text-right">Unidades</th>
                        <th className="px-5 py-3">Operador</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borda">
                      {lista.map((p) => {
                        const op = operadorDe(p);
                        const mudou = p.id in mudancas && mudancas[p.id] !== p.operador_id;
                        return (
                          <tr key={p.id} className={cx(mudou && "bg-amarelo-claro/60")}>
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                className="size-4 accent-azul"
                                aria-label={`Selecionar pedido ${p.nome}`}
                                checked={selecionados.has(p.id)}
                                onChange={() =>
                                  setSelecionados((s) => {
                                    const n = new Set(s);
                                    if (n.has(p.id)) n.delete(p.id);
                                    else n.add(p.id);
                                    return n;
                                  })
                                }
                              />
                            </td>
                            <td className="px-3 py-2 font-medium">{nomeLoja(p.loja_nome, p.loja_numero)}</td>
                            <td className="px-3 py-2">{p.nome}</td>
                            <td className="tabular px-3 py-2 text-right">
                              {fmtNum(p.qtd_pedido)}
                              {p.qtd_separada > 0 && <span className="block text-xs text-suave">{fmtNum(p.qtd_separada)} separadas</span>}
                            </td>
                            <td className="px-5 py-2">
                              <label className="sr-only" htmlFor={`op-${p.id}`}>
                                Operador do pedido {p.nome}
                              </label>
                              <select
                                id={`op-${p.id}`}
                                value={op ?? ""}
                                onChange={(e) => atribuir([p.id], e.target.value || null)}
                                className={cx(
                                  "h-9 w-full min-w-44 rounded-lg border bg-white px-2 text-sm",
                                  op ? "border-borda" : "border-amarelo text-[#7a5200]",
                                )}
                              >
                                <option value="">Sem operador</option>
                                {ops.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.nome}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Cartao>
          </div>

          <Cartao className="self-start">
            <div className="border-b border-borda px-5 py-4">
              <h2 className="font-semibold">Carga por operador</h2>
              <p className="text-xs text-suave">Marque quem participa do “Dividir automaticamente”.</p>
            </div>
            <ul className="divide-y divide-borda">
              {ops.map((o) => {
                const c = carga.get(o.id);
                const max = Math.max(1, ...[...carga.values()].map((x) => x.un));
                return (
                  <li key={o.id} className={cx("px-5 py-3", fora.has(o.id) && "opacity-55")}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-azul"
                          checked={o.papel === "operador" && !fora.has(o.id)}
                          disabled={o.papel !== "operador"}
                          onChange={() =>
                            setFora((f) => {
                              const n = new Set(f);
                              if (n.has(o.id)) n.delete(o.id);
                              else n.add(o.id);
                              return n;
                            })
                          }
                          aria-label={`${o.nome} participa da divisão automática`}
                        />
                        <span className="truncate font-medium">{o.nome}</span>
                        {o.papel !== "operador" && <span className="shrink-0 text-xs text-suave">({ROTULO_PAPEL[o.papel].toLowerCase()})</span>}
                      </label>
                      <span className="tabular shrink-0 text-suave">
                        {c ? `${c.pedidos} ped. · ${fmtNum(c.un)} un.` : "—"}
                      </span>
                    </div>
                    <Barra parte={c?.un ?? 0} total={max} className="mt-2 h-1.5" cor="bg-azul" />
                  </li>
                );
              })}
            </ul>
            <p className="px-5 pb-4 text-xs text-suave">Unidades que ainda faltam separar.</p>
          </Cartao>
        </div>
      )}
    </>
  );
}
