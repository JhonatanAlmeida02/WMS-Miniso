import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight, ClipboardList, Download, Package, Search, Store } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { useConexao } from "../../lib/operacao";
import { baixarCsv } from "../../lib/buscarTudo";
import { fmtData, fmtDataHora, fmtNum, nomeLoja } from "../../lib/formato";
import type { ItemLoja, Loja, PedidoLoja } from "../../lib/tipos";
import { AvisoErro, Barra, Campo, Cartao, Carregando, Selecao, Selo, Titulo, Vazio, cx } from "../../components/ui";
import { EstadoAtualizacao, FILTROS_SITUACAO, Indicador, pctOuSemItens, situacaoPedido, type Visao } from "../../components/loja/comum";

/** Recarrega a cada 30 s como reserva do tempo real (que não é a fonte da verdade). */
export function useAtualizacao(dados: unknown, recarregar: () => void, intervalo = 30_000) {
  const [quando, setQuando] = useState<Date | null>(null);
  useEffect(() => {
    if (dados) setQuando(new Date());
  }, [dados]);
  useEffect(() => {
    const t = setInterval(recarregar, intervalo);
    return () => clearInterval(t);
  }, [recarregar, intervalo]);
  return quando;
}

/**
 * Painel de uma loja: acompanha a separação feita pela PRODIGY, a expedição e
 * o recebimento. O mesmo painel serve ao administrador da loja e ao supervisor.
 * O banco só devolve o que quem está logado pode ver.
 */
export function PainelDaLoja({
  lojaId,
  rotaPedido,
  voltar,
  visao = "prodigy",
}: {
  lojaId: number;
  rotaPedido: (id: number) => string;
  voltar?: string;
  /** A loja vê só pedido, conferido e faltante (não o que a PRODIGY separou ou expediu). */
  visao?: Visao;
}) {
  const daLoja = visao === "loja";
  const online = useConexao();
  const loja = useConsulta<Loja>(() => supabase.from("lojas").select("*").eq("id", lojaId).single(), [lojaId]);
  const pedidos = useConsulta<PedidoLoja[]>(
    () => supabase.from("v_loja_pedidos").select("*").eq("loja_id", lojaId).order("remessa_criada_em", { ascending: false }).limit(500),
    [lojaId],
    { tabelas: ["pedidos", "remessas", "conferencias", "expedicoes", "recebimentos_loja"] },
  );
  const itens = useConsulta<ItemLoja[]>(
    () => supabase.from("v_loja_itens").select("*").eq("loja_id", lojaId).limit(5000),
    [lojaId],
    { tabelas: ["expedicoes", "recebimentos_loja"] },
  );
  const recarregarTudo = useMemo(() => () => {
    pedidos.recarregar();
    itens.recarregar();
  }, [pedidos.recarregar, itens.recarregar]); // eslint-disable-line react-hooks/exhaustive-deps
  const quando = useAtualizacao(pedidos.dados, recarregarTudo);

  const [remessa, setRemessa] = useState("");
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("");
  const [produto, setProduto] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const todos = pedidos.dados ?? [];
  const remessas = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of todos) m.set(p.remessa_id, p.remessa_codigo);
    return [...m.entries()];
  }, [todos]);

  // Pedidos com o produto procurado (GTIN ou nome)
  const pedidosDoProduto = useMemo(() => {
    const t = produto.trim().toLowerCase();
    if (!t) return null;
    return new Set((itens.dados ?? []).filter((i) => i.gtin.includes(t) || i.produto.toLowerCase().includes(t)).map((i) => i.pedido_id));
  }, [produto, itens.dados]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return todos.filter((p) => {
      if (remessa && String(p.remessa_id) !== remessa) return false;
      if (t && !p.pedido_nome.toLowerCase().includes(t) && !p.remessa_codigo.toLowerCase().includes(t)) return false;
      if (situacao && situacaoPedido(p).chave !== situacao) return false;
      if (pedidosDoProduto && !pedidosDoProduto.has(p.pedido_id)) return false;
      const dia = p.remessa_criada_em.slice(0, 10);
      if (de && dia < de) return false;
      if (ate && dia > ate) return false;
      return true;
    });
  }, [todos, remessa, busca, situacao, pedidosDoProduto, de, ate]);

  // "Ativo" = ainda tem algo a separar, expedir ou receber
  const ativos = lista.filter((p) => {
    const s = situacaoPedido(p).chave;
    return p.remessa_status !== "concluida" || (s !== "recebido" && s !== "divergencia");
  });
  const soma = (k: keyof PedidoLoja) => lista.reduce((s, p) => s + (p[k] as number), 0);
  const tot = {
    pedido: soma("qtd_pedido"),
    separado: soma("qtd_separada"),
    conferidoCd: soma("qtd_conferida_cd"),
    expedido: soma("qtd_expedida"),
    recebido: soma("qtd_recebida"),
    avariado: soma("qtd_avariada"),
    volExp: soma("volumes_expedidos"),
    volRec: soma("volumes_recebidos"),
    aguardando: soma("entregas_aguardando"),
    conferindo: soma("entregas_em_conferencia"),
    conferidas: soma("entregas_conferidas"),
    divergencia: soma("entregas_com_divergencia"),
    faltante: lista.reduce((s, p) => s + Math.max(0, p.qtd_pedido - p.qtd_recebida), 0),
  };

  // Pendências por produto, nos pedidos filtrados
  const pendencias = useMemo(() => {
    const ids = new Set(lista.map((p) => p.pedido_id));
    const t = produto.trim().toLowerCase();
    const porGtin = new Map<
      string,
      { gtin: string; produto: string; pedido: number; conferido: number; faltante: number; separar: number; expedir: number; receber: number }
    >();
    for (const i of itens.dados ?? []) {
      if (!ids.has(i.pedido_id)) continue;
      if (t && !i.gtin.includes(t) && !i.produto.toLowerCase().includes(t)) continue;
      const a = porGtin.get(i.gtin) ?? { gtin: i.gtin, produto: i.produto, pedido: 0, conferido: 0, faltante: 0, separar: 0, expedir: 0, receber: 0 };
      a.pedido += i.qtd_pedido;
      a.conferido += i.qtd_recebida;
      a.faltante += Math.max(0, i.qtd_pedido - i.qtd_recebida);
      a.separar += Math.max(0, i.qtd_pedido - i.qtd_separada);
      a.expedir += Math.max(0, i.qtd_pedido - i.qtd_expedida);
      a.receber += i.qtd_a_receber;
      porGtin.set(i.gtin, a);
    }
    const todosItens = [...porGtin.values()];
    if (daLoja) return todosItens.filter((x) => x.faltante).sort((a, b) => b.faltante - a.faltante || a.produto.localeCompare(b.produto));
    return todosItens
      .filter((x) => x.separar || x.expedir || x.receber)
      .sort((a, b) => b.expedir - a.expedir || b.separar - a.separar || a.produto.localeCompare(b.produto));
  }, [lista, itens.dados, produto, daLoja]);

  function exportar() {
    if (daLoja) {
      baixarCsv(`pedidos-loja-${loja.dados?.numero ?? lojaId}.csv`, [
        ["Remessa", "Pedido", "Situação", "Pedido (un.)", "Conferido (un.)", "Faltante (un.)", "Avariado (un.)"],
        ...lista.map((p) => [
          p.remessa_codigo,
          p.pedido_nome,
          situacaoPedido(p).texto,
          p.qtd_pedido,
          p.qtd_recebida,
          Math.max(0, p.qtd_pedido - p.qtd_recebida),
          p.qtd_avariada,
        ]),
      ]);
      return;
    }
    baixarCsv(`painel-loja-${loja.dados?.numero ?? lojaId}.csv`, [
      ["Remessa", "Pedido", "Situação", "Pedido (un.)", "Separado (un.)", "Conferido CD (un.)", "Expedido (un.)", "Recebido (un.)", "Avariado (un.)", "Entregas", "Volumes"],
      ...lista.map((p) => [
        p.remessa_codigo,
        p.pedido_nome,
        situacaoPedido(p).texto,
        p.qtd_pedido,
        p.qtd_separada,
        p.qtd_conferida_cd,
        p.qtd_expedida,
        p.qtd_recebida,
        p.qtd_avariada,
        p.expedicoes,
        p.volumes_expedidos,
      ]),
    ]);
  }

  if (loja.carregando && !loja.dados) return <Carregando />;
  if (!loja.dados) {
    return (
      <Cartao>
        <Vazio icone={<Store className="size-8" />} titulo="Painel da loja indisponível">
          O acompanhamento ainda não foi habilitado para esta loja. Fale com a PRODIGY.
        </Vazio>
      </Cartao>
    );
  }

  return (
    <>
      <Titulo
        titulo={`Painel · ${nomeLoja(loja.dados.nome, loja.dados.numero)}`}
        descricao={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {voltar && (
              <Link to={voltar} className="inline-flex items-center gap-1 font-medium text-azul-escuro hover:underline">
                <ArrowLeft className="size-3.5" /> Voltar
              </Link>
            )}
            {daLoja ? "Pedidos desta loja e o que já foi conferido aqui." : "Separação feita pela PRODIGY, expedição e recebimento desta loja."}
          </span>
        }
        acoes={<EstadoAtualizacao quando={quando} online={online} aoAtualizar={recarregarTudo} />}
      />
      {pedidos.erro && <AvisoErro>{pedidos.erro}</AvisoErro>}

      {daLoja ? (
        // Loja: só o que ela pediu, o que conferiu e o que falta (sem números da PRODIGY)
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <Indicador rotulo="Pedidos ativos" valor={fmtNum(ativos.length)} detalhe={`${fmtNum(lista.length)} no filtro`} />
          <Indicador rotulo="Pedido" valor={fmtNum(tot.pedido)} detalhe="un. pedidas" />
          <Indicador
            rotulo="Conferido"
            valor={fmtNum(tot.recebido)}
            detalhe={tot.avariado ? `${fmtNum(tot.avariado)} avariadas` : "un. conferidas na loja"}
            destaque="bg-ciano"
          />
          <Indicador rotulo="Faltante" valor={fmtNum(tot.faltante)} detalhe="pedido − conferido" destaque={tot.faltante ? "bg-erro" : "bg-ciano"} />
          <Indicador rotulo="Volumes" valor={`${fmtNum(tot.volRec)}/${fmtNum(tot.volExp)}`} detalhe="conferidos/recebidos" />
          <Indicador rotulo="Entregas a conferir" valor={fmtNum(tot.aguardando + tot.conferindo)} destaque="bg-amarelo" />
          <Indicador rotulo="Entregas finalizadas" valor={fmtNum(tot.conferidas + tot.divergencia)} destaque="bg-azul" />
        </div>
      ) : (
        // PRODIGY: separação, conferência do CD e recebimento, em cartões menores
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <Indicador rotulo="Pedidos ativos" valor={fmtNum(ativos.length)} detalhe={`${fmtNum(lista.length)} no filtro`} />
          <Indicador rotulo="Separado" valor={pctOuSemItens(tot.separado, tot.pedido)} detalhe={`${fmtNum(tot.separado)} de ${fmtNum(tot.pedido)} un.`} destaque="bg-ciano">
            <Barra parte={tot.separado} total={tot.pedido} className="mt-1.5" />
          </Indicador>
          <Indicador rotulo="Conferido no CD" valor={fmtNum(tot.conferidoCd)} detalhe="un. na conferência de saída" />
          <Indicador
            rotulo="Recebido"
            valor={fmtNum(tot.recebido)}
            detalhe={tot.avariado ? `${fmtNum(tot.avariado)} un. avariadas` : "un. conferidas na loja"}
            destaque="bg-ciano"
          />
          <Indicador rotulo="Volumes" valor={`${fmtNum(tot.volRec)}/${fmtNum(tot.volExp)}`} detalhe={`recebidos/expedidos · ${fmtNum(tot.volExp - tot.volRec)} pendentes`} />
          <Indicador rotulo="Aguardando conferência" valor={fmtNum(tot.aguardando)} destaque="bg-amarelo" />
          <Indicador rotulo="Em conferência / finalizadas" valor={`${fmtNum(tot.conferindo)} / ${fmtNum(tot.conferidas + tot.divergencia)}`} destaque="bg-azul" />
        </div>
      )}

      {/* Filtros */}
      <Cartao className="mt-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Selecao rotulo="Remessa" value={remessa} onChange={(e) => setRemessa(e.target.value)}>
            <option value="">Todas</option>
            {remessas.map(([id, codigo]) => (
              <option key={id} value={id}>
                {codigo}
              </option>
            ))}
          </Selecao>
          <Campo rotulo="Pedido" placeholder="Código do pedido" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Selecao rotulo="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {FILTROS_SITUACAO.map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </Selecao>
          <Campo rotulo="Produto" placeholder="GTIN ou nome" value={produto} onChange={(e) => setProduto(e.target.value)} inputMode="search" />
          <Campo rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Campo rotulo="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
      </Cartao>

      {/* Pedidos */}
      <Cartao className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda px-5 py-3">
          <h2 className="font-semibold">Pedidos da loja</h2>
          <button
            type="button"
            onClick={exportar}
            disabled={!lista.length}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline disabled:opacity-40"
          >
            <Download className="size-4" /> Exportar CSV
          </button>
        </div>
        {pedidos.carregando && !pedidos.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={<ClipboardList className="size-8" />} titulo="Nenhum pedido">
            {todos.length ? "Nenhum pedido com esses filtros." : "Quando a PRODIGY importar um pedido para esta loja, ele aparece aqui."}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className={cx("w-full text-sm", daLoja ? "min-w-[760px]" : "min-w-[980px]")}>
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                {daLoja ? (
                  <tr>
                    <th className="px-5 py-3">Pedido</th>
                    <th className="px-3 py-3">Datas</th>
                    <th className="px-3 py-3">Situação</th>
                    <th className="px-3 py-3 text-right">Pedido</th>
                    <th className="px-3 py-3 text-right">Conferido</th>
                    <th className="px-3 py-3 text-right">Faltante</th>
                    <th className="px-5 py-3" />
                  </tr>
                ) : (
                <tr>
                  <th className="px-5 py-3">Pedido</th>
                  <th className="px-3 py-3">Datas</th>
                  <th className="px-3 py-3">Separação</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-3 py-3 text-right">Pedido</th>
                  <th className="px-3 py-3 text-right">Expedido</th>
                  <th className="px-3 py-3 text-right">Recebido</th>
                  <th className="px-5 py-3" />
                </tr>
                )}
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((p) => {
                  const s = situacaoPedido(p);
                  if (daLoja) {
                    const f = Math.max(0, p.qtd_pedido - p.qtd_recebida);
                    return (
                      <tr key={p.pedido_id} className="hover:bg-fundo/60">
                        <td className="px-5 py-3">
                          <span className="font-medium">{p.pedido_nome}</span>
                          <span className="block text-xs text-suave">Remessa {p.remessa_codigo}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-suave">
                          <span className="block">Criado {fmtData(p.remessa_criada_em)}</span>
                          {p.ultima_expedicao_em && <span className="block">Enviado {fmtDataHora(p.ultima_expedicao_em)}</span>}
                        </td>
                        <td className="px-3 py-3">
                          <Selo className={s.classe}>{s.texto}</Selo>
                        </td>
                        <td className="tabular px-3 py-3 text-right">{fmtNum(p.qtd_pedido)}</td>
                        <td className="tabular px-3 py-3 text-right font-semibold">{fmtNum(p.qtd_recebida)}</td>
                        <td className={cx("tabular px-3 py-3 text-right font-semibold", f > 0 ? "text-erro" : "text-suave")}>{f ? fmtNum(f) : "—"}</td>
                        <td className="px-5 py-3 text-right">
                          <Link to={rotaPedido(p.pedido_id)} className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-azul-escuro hover:underline">
                            Ver detalhes <ArrowRight className="size-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.pedido_id} className="hover:bg-fundo/60">
                      <td className="px-5 py-3">
                        <span className="font-medium">{p.pedido_nome}</span>
                        <span className="block text-xs text-suave">Remessa {p.remessa_codigo}</span>
                      </td>
                      <td className="px-3 py-3 text-xs text-suave">
                        <span className="block">Criado {fmtData(p.remessa_criada_em)}</span>
                        {p.ultima_expedicao_em && <span className="block">Expedido {fmtDataHora(p.ultima_expedicao_em)}</span>}
                      </td>
                      <td className="w-44 px-3 py-3">
                        <span className="tabular text-sm font-semibold">{pctOuSemItens(p.qtd_separada, p.qtd_pedido)}</span>
                        <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-1" />
                      </td>
                      <td className="px-3 py-3">
                        <Selo className={s.classe}>{s.texto}</Selo>
                      </td>
                      <td className="tabular px-3 py-3 text-right">{fmtNum(p.qtd_pedido)}</td>
                      <td className="tabular px-3 py-3 text-right">
                        {fmtNum(p.qtd_expedida)}
                        {p.expedicoes > 0 && (
                          <span className="block text-xs text-suave">
                            {p.expedicoes} {p.expedicoes === 1 ? "entrega" : "entregas"} · {p.volumes_expedidos} vol.
                          </span>
                        )}
                      </td>
                      <td className={cx("tabular px-3 py-3 text-right", p.entregas_com_divergencia > 0 && "text-erro")}>{fmtNum(p.qtd_recebida)}</td>
                      <td className="px-5 py-3 text-right">
                        <Link to={rotaPedido(p.pedido_id)} className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-azul-escuro hover:underline">
                          Ver detalhes <ArrowRight className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      {/* Pendências por produto */}
      <Cartao className="mt-4 overflow-hidden">
        <div className="border-b border-borda px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Package className="size-4 text-azul" aria-hidden /> Pendências por produto
          </h2>
          <p className="text-xs text-suave">
            {daLoja
              ? "Produtos que ainda faltam: pedido − conferido na loja."
              : "Falta separar = pedido − separado. A expedir = pedido − expedido. A receber = expedido e ainda não conferido na loja."}
          </p>
        </div>
        {pendencias.length === 0 ? (
          <Vazio icone={<Search className="size-8" />} titulo="Sem pendências">
            {daLoja ? "Nos pedidos filtrados, tudo o que foi pedido já foi conferido." : "Nos pedidos filtrados, tudo já foi separado, expedido e conferido."}
          </Vazio>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                {daLoja ? (
                  <tr>
                    <th className="px-5 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Pedido</th>
                    <th className="px-3 py-2 text-right">Conferido</th>
                    <th className="px-5 py-2 text-right">Faltante</th>
                  </tr>
                ) : (
                <tr>
                  <th className="px-5 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Falta separar</th>
                  <th className="px-3 py-2 text-right">A expedir</th>
                  <th className="px-5 py-2 text-right">A receber</th>
                </tr>
                )}
              </thead>
              <tbody className="divide-y divide-borda">
                {pendencias.slice(0, 200).map((x) => (
                  <tr key={x.gtin}>
                    <td className="px-5 py-2">
                      <span className="line-clamp-1">{x.produto}</span>
                      <span className="tabular block text-xs text-suave">{x.gtin}</span>
                    </td>
                    {daLoja ? (
                      <>
                        <td className="tabular px-3 py-2 text-right">{x.pedido}</td>
                        <td className="tabular px-3 py-2 text-right">{x.conferido}</td>
                        <td className="tabular px-5 py-2 text-right font-semibold text-erro">{x.faltante}</td>
                      </>
                    ) : (
                      <>
                        <td className="tabular px-3 py-2 text-right">{x.separar || "—"}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold">{x.expedir || "—"}</td>
                        <td className="tabular px-5 py-2 text-right">{x.receber || "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}

/** Rota do administrador da loja: a loja vem do perfil (e o banco confere). */
export default function PainelLoja() {
  const { perfil } = useAuth();
  return <PainelDaLoja lojaId={perfil?.loja_id ?? -1} rotaPedido={(id) => `/loja/pedidos/${id}`} visao="loja" />;
}

/** Rota do supervisor: abre o painel de qualquer loja. */
export function PainelLojaSupervisor() {
  const { lojaId } = useParams();
  const id = Number(lojaId);
  return <PainelDaLoja lojaId={id} rotaPedido={(p) => `/lojas-miniso/loja/${id}/pedidos/${p}`} voltar="/lojas-miniso" />;
}
