import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Eye, Store } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { useConexao } from "../../lib/operacao";
import { fmtNum, fmtPct, nomeLoja } from "../../lib/formato";
import type { Divergencia, Loja, PedidoLoja } from "../../lib/tipos";
import { AvisoErro, Barra, Campo, Cartao, Carregando, Selecao, SeloStatus, Titulo, Vazio, cx } from "../../components/ui";
import { EstadoAtualizacao, Indicador } from "../../components/loja/comum";
import { PainelDaLoja, useAtualizacao } from "../loja/PainelLoja";
import { DetalhePedidoLoja } from "../loja/PedidoLoja";

/**
 * Visão do visualizador: andamento da operação MINISO nas lojas do seu escopo,
 * da separação no CD ao recebimento na loja. Somente leitura e sem exportação.
 * O banco só devolve as lojas autorizadas; os totais somam só essas linhas.
 */

interface Totais {
  pedidos: number;
  pedido: number;
  separado: number;
  conferidoCd: number;
  expedido: number;
  recebido: number;
  volumesExp: number;
  volumesRec: number;
  entregasDiv: number;
}

const zero = (): Totais => ({ pedidos: 0, pedido: 0, separado: 0, conferidoCd: 0, expedido: 0, recebido: 0, volumesExp: 0, volumesRec: 0, entregasDiv: 0 });

function somar(t: Totais, p: PedidoLoja) {
  t.pedidos += 1;
  t.pedido += p.qtd_pedido;
  t.separado += p.qtd_separada;
  t.conferidoCd += p.qtd_conferida_cd;
  t.expedido += p.qtd_expedida;
  t.recebido += p.qtd_recebida;
  t.volumesExp += p.volumes_expedidos;
  t.volumesRec += p.volumes_recebidos;
  t.entregasDiv += p.entregas_com_divergencia;
}

export default function VisaoRede() {
  const { perfil } = useAuth();
  const online = useConexao();
  const global = perfil?.escopo_visualizador === "global_miniso";
  const [remessa, setRemessa] = useState("");
  const [lojaFiltro, setLojaFiltro] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*").order("numero").order("nome"), []);
  const pedidos = useConsulta<PedidoLoja[]>(
    () => supabase.from("v_loja_pedidos").select("*").order("remessa_criada_em", { ascending: false }).limit(5000),
    [],
    { tabelas: ["pedidos", "remessas", "conferencias", "expedicoes", "recebimentos_loja"] },
  );
  const divergencias = useConsulta<Pick<Divergencia, "id" | "loja_id" | "remessa_id" | "status" | "atual">[]>(
    () => supabase.from("v_divergencias").select("id, loja_id, remessa_id, status, atual").neq("status", "resolvida").limit(5000),
    [],
    { tabelas: ["divergencias"] },
  );
  const quando = useAtualizacao(pedidos.dados, pedidos.recarregar);

  const remessas = useMemo(() => {
    const m = new Map<number, { id: number; codigo: string; status: PedidoLoja["remessa_status"]; criada: string }>();
    for (const p of pedidos.dados ?? []) {
      if (!m.has(p.remessa_id)) m.set(p.remessa_id, { id: p.remessa_id, codigo: p.remessa_codigo, status: p.remessa_status, criada: p.remessa_criada_em });
    }
    return [...m.values()];
  }, [pedidos.dados]);

  // Filtros: remessa, loja e período (data de criação da remessa)
  const lista = useMemo(
    () =>
      (pedidos.dados ?? []).filter(
        (p) =>
          (!remessa || p.remessa_id === Number(remessa)) &&
          (!lojaFiltro || p.loja_id === Number(lojaFiltro)) &&
          (!de || p.remessa_criada_em.slice(0, 10) >= de) &&
          (!ate || p.remessa_criada_em.slice(0, 10) <= ate),
      ),
    [pedidos.dados, remessa, lojaFiltro, de, ate],
  );
  const remessasNaLista = useMemo(() => new Set(lista.map((p) => p.remessa_id)), [lista]);
  const divAbertas = useMemo(
    () =>
      (divergencias.dados ?? []).filter(
        (d) => d.atual && remessasNaLista.has(d.remessa_id) && (!lojaFiltro || d.loja_id === Number(lojaFiltro)),
      ),
    [divergencias.dados, remessasNaLista, lojaFiltro],
  );

  const total = useMemo(() => {
    const t = zero();
    for (const p of lista) somar(t, p);
    return t;
  }, [lista]);

  const porLoja = useMemo(() => {
    const m = new Map<number, Totais & { nome: string; numero: number | null; divAbertas: number }>();
    for (const l of lojas.dados ?? []) {
      if (lojaFiltro && l.id !== Number(lojaFiltro)) continue;
      m.set(l.id, { ...zero(), nome: l.nome, numero: l.numero, divAbertas: 0 });
    }
    for (const p of lista) {
      const linha = m.get(p.loja_id);
      if (linha) somar(linha, p);
    }
    for (const d of divAbertas) {
      const linha = m.get(d.loja_id);
      if (linha) linha.divAbertas += 1;
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v }));
  }, [lojas.dados, lista, divAbertas, lojaFiltro]);

  const porRemessa = useMemo(() => {
    const m = new Map<number, Totais & { codigo: string; status: PedidoLoja["remessa_status"]; lojas: Set<number> }>();
    for (const p of lista) {
      let linha = m.get(p.remessa_id);
      if (!linha) {
        linha = { ...zero(), codigo: p.remessa_codigo, status: p.remessa_status, lojas: new Set() };
        m.set(p.remessa_id, linha);
      }
      somar(linha, p);
      linha.lojas.add(p.loja_id);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v }));
  }, [lista]);

  const semLojas = !lojas.carregando && (lojas.dados ?? []).length === 0;

  return (
    <>
      <Titulo
        titulo={global ? "Visão da rede MINISO" : "Visão das suas lojas"}
        descricao={
          <>
            <Eye className="mr-1 inline size-4 align-[-3px]" aria-hidden />
            Somente leitura. Da separação no CD da PRODIGY ao recebimento em cada loja{global ? " da rede" : " do seu acesso"}.
          </>
        }
        acoes={<EstadoAtualizacao quando={quando} online={online} aoAtualizar={pedidos.recarregar} />}
      />
      {(pedidos.erro || lojas.erro) && <AvisoErro>{pedidos.erro ?? lojas.erro}</AvisoErro>}

      {semLojas ? (
        <Cartao>
          <Vazio icone={<Store className="size-8" />} titulo="Nenhuma loja liberada para esta conta">
            Quando a PRODIGY atribuir lojas ao seu acesso, os painéis aparecem aqui.
          </Vazio>
        </Cartao>
      ) : (
        <>
          <Cartao className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Selecao rotulo="Remessa" value={remessa} onChange={(e) => setRemessa(e.target.value)}>
              <option value="">Todas</option>
              {remessas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.codigo}
                </option>
              ))}
            </Selecao>
            <Selecao rotulo="Loja" value={lojaFiltro} onChange={(e) => setLojaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {(lojas.dados ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {nomeLoja(l.nome, l.numero)}
                </option>
              ))}
            </Selecao>
            <Campo rotulo="De" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            <Campo rotulo="Até" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Cartao>

          {pedidos.carregando && !pedidos.dados ? (
            <Carregando />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Indicador rotulo="Lojas com pedido" valor={`${porLoja.filter((l) => l.pedidos).length}/${porLoja.length}`} detalhe={`${fmtNum(total.pedidos)} pedidos`} />
                <Indicador rotulo="Separado no CD" valor={fmtPct(total.separado, total.pedido)} detalhe={`${fmtNum(total.separado)} de ${fmtNum(total.pedido)} un.`} destaque="bg-ciano">
                  <Barra parte={total.separado} total={total.pedido} className="mt-2" />
                </Indicador>
                <Indicador rotulo="Conferido no CD" valor={fmtNum(total.conferidoCd)} detalhe="un. na conferência de saída" />
                <Indicador rotulo="Expedido" valor={fmtNum(total.expedido)} detalhe={`${fmtNum(total.volumesExp)} volumes`} />
                <Indicador rotulo="Recebido nas lojas" valor={fmtNum(total.recebido)} detalhe={`${fmtNum(total.volumesRec)} de ${fmtNum(total.volumesExp)} vol. conferidos`} destaque="bg-ciano" />
                <Indicador
                  rotulo="Divergências abertas"
                  valor={fmtNum(divAbertas.length)}
                  detalhe={`${fmtNum(total.entregasDiv)} ${total.entregasDiv === 1 ? "entrega" : "entregas"} com divergência`}
                  destaque={divAbertas.length ? "bg-erro" : "bg-azul"}
                />
              </div>

              <Cartao className="mt-4 overflow-hidden">
                <div className="border-b border-borda px-5 py-3">
                  <h2 className="font-semibold">Comparativo por loja</h2>
                  <p className="text-xs text-suave">Mesmos filtros acima. Toque numa loja para ver pedidos e entregas.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                      <tr>
                        <th className="px-5 py-3">Loja</th>
                        <th className="px-3 py-3 text-right">Pedidos</th>
                        <th className="px-3 py-3 text-right">Pedido</th>
                        <th className="w-40 px-3 py-3">Separado</th>
                        <th className="px-3 py-3 text-right">Conferido CD</th>
                        <th className="px-3 py-3 text-right">Expedido</th>
                        <th className="px-3 py-3 text-right">Recebido</th>
                        <th className="px-3 py-3 text-right">Volumes</th>
                        <th className="px-3 py-3 text-right">Diverg.</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borda">
                      {porLoja.map((l) => (
                        <tr key={l.id} className={cx(!l.pedidos && "text-suave")}>
                          <td className="px-5 py-3 font-medium">{nomeLoja(l.nome, l.numero)}</td>
                          <td className="tabular px-3 py-3 text-right">{fmtNum(l.pedidos)}</td>
                          <td className="tabular px-3 py-3 text-right">{fmtNum(l.pedido)}</td>
                          <td className="px-3 py-3">
                            {l.pedido ? (
                              <>
                                <span className="tabular text-xs">{fmtPct(l.separado, l.pedido)}</span>
                                <Barra parte={l.separado} total={l.pedido} className="mt-1" />
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="tabular px-3 py-3 text-right">{fmtNum(l.conferidoCd)}</td>
                          <td className="tabular px-3 py-3 text-right">{fmtNum(l.expedido)}</td>
                          <td className="tabular px-3 py-3 text-right">{fmtNum(l.recebido)}</td>
                          <td className="tabular px-3 py-3 text-right">
                            {fmtNum(l.volumesRec)}/{fmtNum(l.volumesExp)}
                          </td>
                          <td className={cx("tabular px-3 py-3 text-right", l.divAbertas > 0 && "font-semibold text-erro")}>{fmtNum(l.divAbertas)}</td>
                          <td className="px-5 py-3 text-right">
                            <Link to={`/visao/loja/${l.id}`} className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-azul-escuro hover:underline">
                              Ver loja <ArrowRight className="size-3.5" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Cartao>

              <Cartao className="mt-4 overflow-hidden">
                <div className="border-b border-borda px-5 py-3">
                  <h2 className="font-semibold">Andamento das remessas</h2>
                  <p className="text-xs text-suave">Totais só das lojas do seu acesso.</p>
                </div>
                {porRemessa.length === 0 ? (
                  <Vazio titulo="Nenhuma remessa com esses filtros" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                        <tr>
                          <th className="px-5 py-3">Remessa</th>
                          <th className="px-3 py-3">Situação</th>
                          <th className="px-3 py-3 text-right">Lojas</th>
                          <th className="px-3 py-3 text-right">Pedido</th>
                          <th className="w-40 px-3 py-3">Separado</th>
                          <th className="px-3 py-3 text-right">Expedido</th>
                          <th className="px-5 py-3 text-right">Recebido</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-borda">
                        {porRemessa.map((r) => (
                          <tr key={r.id}>
                            <td className="px-5 py-3 font-medium">{r.codigo}</td>
                            <td className="px-3 py-3">
                              <SeloStatus status={r.status} />
                            </td>
                            <td className="tabular px-3 py-3 text-right">{r.lojas.size}</td>
                            <td className="tabular px-3 py-3 text-right">{fmtNum(r.pedido)}</td>
                            <td className="px-3 py-3">
                              <span className="tabular text-xs">{fmtPct(r.separado, r.pedido)}</span>
                              <Barra parte={r.separado} total={r.pedido} className="mt-1" />
                            </td>
                            <td className="tabular px-3 py-3 text-right">{fmtNum(r.expedido)}</td>
                            <td className="tabular px-5 py-3 text-right">{fmtNum(r.recebido)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Cartao>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Painel de uma loja do escopo, sem exportação. */
export function VisaoLoja() {
  const { lojaId } = useParams();
  const id = Number(lojaId);
  return <PainelDaLoja lojaId={id} rotaPedido={(p) => `/visao/loja/${id}/pedidos/${p}`} voltar="/visao" exportar={false} />;
}

export function VisaoPedido() {
  const { lojaId, id } = useParams();
  return <DetalhePedidoLoja pedidoId={Number(id)} voltar={`/visao/loja/${lojaId}`} />;
}
