import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ClipboardCheck, PackageCheck, ScanBarcode, Truck } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { useConexao } from "../../lib/operacao";
import { fmtData, fmtDataHora, fmtNum } from "../../lib/formato";
import type { Divergencia, Expedicao, ItemLoja, LinhaRecebimento, PedidoLoja as TPedidoLoja } from "../../lib/tipos";
import { AvisoErro, Barra, Botao, Cartao, Carregando, Modal, Selo, Vazio, cx } from "../../components/ui";
import {
  ConfrontoRecebimento,
  EstadoAtualizacao,
  Indicador,
  ROTULO_STATUS_DIVERGENCIA,
  ROTULO_TIPO,
  SeloRecebimento,
  pctOuSemItens,
  podeConferir,
  situacaoPedido,
  type Visao,
} from "../../components/loja/comum";
import { useAtualizacao } from "./PainelLoja";

/** Confronto de uma entrega, num modal (loja e supervisor). */
export function ModalConfronto({ entrega, aoFechar, visao = "prodigy" }: { entrega: Expedicao | null; aoFechar: () => void; visao?: Visao }) {
  const [linhas, setLinhas] = useState<LinhaRecebimento[] | null>(null);
  useEffect(() => {
    if (!entrega) return;
    setLinhas(null);
    supabase.rpc("resumo_recebimento", { p_recebimento: entrega.recebimento_id }).then(({ data }) => setLinhas((data ?? []) as LinhaRecebimento[]));
  }, [entrega]);
  return (
    <Modal aberto={!!entrega} aoFechar={aoFechar} titulo={`Confronto · entrega ${entrega?.numero ?? ""} · pedido ${entrega?.pedido_nome ?? ""}`} largura="max-w-3xl">
      {entrega?.recebimento_status === "em_conferencia" && (
        <p className="mb-3 rounded-xl bg-azul-claro px-3 py-2 text-sm text-azul-escuro">Conferência ainda em andamento: os números podem mudar.</p>
      )}
      {linhas ? <ConfrontoRecebimento linhas={linhas} visao={visao} /> : <Carregando />}
    </Modal>
  );
}

/** Detalhe do pedido da loja: produtos, entregas parciais e histórico do recebimento. */
export function DetalhePedidoLoja({
  pedidoId,
  voltar,
  rotaConferir,
  visao = "prodigy",
}: {
  pedidoId: number;
  voltar: string;
  rotaConferir?: (recebimento: number) => string;
  /** A loja vê só pedido, conferido e faltante. */
  visao?: Visao;
}) {
  const daLoja = visao === "loja";
  const online = useConexao();
  const navegar = useNavigate();
  const pedido = useConsulta<TPedidoLoja>(() => supabase.from("v_loja_pedidos").select("*").eq("pedido_id", pedidoId).single(), [pedidoId], {
    tabelas: ["pedidos", "conferencias", "expedicoes", "recebimentos_loja"],
  });
  const itens = useConsulta<ItemLoja[]>(() => supabase.from("v_loja_itens").select("*").eq("pedido_id", pedidoId).order("produto"), [pedidoId], {
    tabelas: ["expedicoes", "recebimentos_loja"],
  });
  const entregas = useConsulta<Expedicao[]>(() => supabase.from("v_expedicoes").select("*").eq("pedido_id", pedidoId).order("numero"), [pedidoId], {
    tabelas: ["expedicoes", "recebimentos_loja", "divergencias"],
  });
  const divergencias = useConsulta<Divergencia[]>(
    () => supabase.from("v_divergencias").select("*").eq("pedido_id", pedidoId).order("criada_em", { ascending: false }),
    [pedidoId],
    { tabelas: ["divergencias"] },
  );
  const recarregar = () => {
    pedido.recarregar();
    itens.recarregar();
    entregas.recarregar();
    divergencias.recarregar();
  };
  const quando = useAtualizacao(pedido.dados, pedido.recarregar);
  const [confronto, setConfronto] = useState<Expedicao | null>(null);

  if (pedido.carregando && !pedido.dados) return <Carregando />;
  const p = pedido.dados;
  if (!p) {
    return (
      <Cartao>
        <Vazio icone={<ClipboardCheck className="size-8" />} titulo="Pedido não encontrado">
          <Link to={voltar} className="font-medium text-azul-escuro hover:underline">
            Voltar ao painel
          </Link>
        </Vazio>
      </Cartao>
    );
  }
  const s = situacaoPedido(p);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={voltar} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-azul-escuro hover:underline">
            <ArrowLeft className="size-4" /> Painel da loja
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Pedido {p.pedido_nome}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-suave">
            Remessa {p.remessa_codigo} · criada {fmtData(p.remessa_criada_em)} <Selo className={s.classe}>{s.texto}</Selo>
          </p>
        </div>
        <EstadoAtualizacao quando={quando} online={online} aoAtualizar={recarregar} />
      </div>

      {daLoja ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Pedido" valor={fmtNum(p.qtd_pedido)} detalhe={`${p.itens} produtos`} />
          <Indicador rotulo="Conferido" valor={fmtNum(p.qtd_recebida)} detalhe={p.qtd_avariada ? `${fmtNum(p.qtd_avariada)} avariadas` : "un. conferidas na loja"} destaque="bg-ciano" />
          <Indicador
            rotulo="Faltante"
            valor={fmtNum(Math.max(0, p.qtd_pedido - p.qtd_recebida))}
            detalhe="pedido − conferido"
            destaque={p.qtd_pedido > p.qtd_recebida ? "bg-erro" : "bg-ciano"}
          />
          <Indicador rotulo="Volumes" valor={`${p.volumes_recebidos}/${p.volumes_expedidos}`} detalhe="conferidos/recebidos" />
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Indicador rotulo="Pedido" valor={fmtNum(p.qtd_pedido)} detalhe={`${p.itens} produtos`} />
        <Indicador rotulo="Separado" valor={pctOuSemItens(p.qtd_separada, p.qtd_pedido)} detalhe={`${fmtNum(p.qtd_separada)} un.`} destaque="bg-ciano">
          <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-2" />
        </Indicador>
        <Indicador rotulo="Conferido no CD" valor={fmtNum(p.qtd_conferida_cd)} detalhe={p.conferencia_cd_status === "finalizada" ? "conferência finalizada" : p.conferencia_cd_status ? "em conferência" : "ainda não conferido"} />
        <Indicador rotulo="Expedido" valor={fmtNum(p.qtd_expedida)} detalhe={`${fmtNum(Math.max(0, p.qtd_pedido - p.qtd_expedida))} un. a expedir`} destaque="bg-amarelo" />
        <Indicador rotulo="Recebido" valor={fmtNum(p.qtd_recebida)} detalhe={p.qtd_avariada ? `${fmtNum(p.qtd_avariada)} avariadas` : `${p.volumes_recebidos}/${p.volumes_expedidos} volumes`} destaque={p.entregas_com_divergencia ? "bg-erro" : "bg-ciano"} />
      </div>
      )}

      {/* Entregas */}
      <Cartao className="mt-6 overflow-hidden">
        <div className="border-b border-borda px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Truck className="size-4 text-azul" aria-hidden /> Entregas
          </h2>
          {!daLoja && <p className="text-xs text-suave">Cada entrega é conferida contra o que saiu nela, não contra o pedido inteiro.</p>}
        </div>
        {entregas.erro && <AvisoErro>{entregas.erro}</AvisoErro>}
        {(entregas.dados ?? []).length === 0 ? (
          <Vazio icone={<Truck className="size-8" />} titulo="Nada expedido ainda">
            Quando a PRODIGY registrar a saída do CD, a entrega aparece aqui para conferência.
          </Vazio>
        ) : (
          <ul className="divide-y divide-borda">
            {(entregas.dados ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-azul-claro text-lg font-semibold text-azul-escuro">{e.numero}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    Entrega {e.numero} · {e.volumes} {e.volumes === 1 ? "volume" : "volumes"} <SeloRecebimento status={e.recebimento_status} />
                    {e.revisao > 1 && <Selo className="bg-navy/8 text-suave">recontagem {e.revisao}</Selo>}
                  </p>
                  <p className="tabular text-xs text-suave">
                    {daLoja ? (
                      <>
                        Enviada {fmtDataHora(e.expedida_em)} · {e.produtos} {e.produtos === 1 ? "produto" : "produtos"}
                        {e.recebimento_status !== "aguardando" && ` · conferido ${fmtNum(e.qtd_integra + e.qtd_avariada)} un.`}
                      </>
                    ) : (
                      <>
                        Expedida {fmtDataHora(e.expedida_em)} · {fmtNum(e.qtd_expedida)} un. em {e.produtos} {e.produtos === 1 ? "produto" : "produtos"}
                        {e.recebimento_status !== "aguardando" && ` · recebido ${fmtNum(e.qtd_integra + e.qtd_avariada)} un.`}
                      </>
                    )}
                    {e.qtd_avariada > 0 && ` (${fmtNum(e.qtd_avariada)} avariadas)`}
                    {e.finalizado_em && ` · finalizada ${fmtDataHora(e.finalizado_em)}`}
                    {e.finalizado_por_nome && ` por ${e.finalizado_por_nome}`}
                  </p>
                  {e.observacao && <p className="text-xs text-suave">Obs.: {e.observacao}</p>}
                </div>
                <div className="flex gap-2">
                  {e.recebimento_status !== "aguardando" && (
                    <Botao variante="fantasma" tamanho="sm" onClick={() => setConfronto(e)}>
                      Ver confronto
                    </Botao>
                  )}
                  {rotaConferir && podeConferir(e) && (
                    <Botao tamanho="sm" icone={<ScanBarcode className="size-4" />} onClick={() => navegar(rotaConferir(e.recebimento_id))}>
                      Conferir recebimento
                    </Botao>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {/* Produtos */}
      <Cartao className="mt-4 overflow-hidden">
        <div className="border-b border-borda px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <PackageCheck className="size-4 text-azul" aria-hidden /> Produtos
          </h2>
        </div>
        {itens.carregando && !itens.dados ? (
          <Carregando />
        ) : (
          <div className="max-h-[520px] overflow-auto">
            {daLoja ? (
              <table className="w-full min-w-[480px] text-sm">
                <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                  <tr>
                    <th className="px-5 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Pedido</th>
                    <th className="px-3 py-2 text-right">Conferido</th>
                    <th className="px-5 py-2 text-right">Faltante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {(itens.dados ?? []).map((i) => {
                    const f = Math.max(0, i.qtd_pedido - i.qtd_recebida);
                    return (
                      <tr key={i.item_id}>
                        <td className="px-5 py-2">
                          <span className="line-clamp-1">{i.produto}</span>
                          <span className="tabular block text-xs text-suave">
                            {i.gtin}
                            {i.qtd_avariada > 0 && <span className="font-semibold text-[#7a5200]"> · {i.qtd_avariada} avariada(s)</span>}
                          </span>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{i.qtd_pedido}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold">{i.qtd_recebida}</td>
                        <td className={cx("tabular px-5 py-2 text-right font-semibold", f > 0 ? "text-erro" : "text-suave")}>{f || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-2">Produto</th>
                  <th className="px-2 py-2 text-right">Pedido</th>
                  <th className="px-2 py-2 text-right">Separado</th>
                  <th className="px-2 py-2 text-right">Expedido</th>
                  <th className="px-2 py-2 text-right">Recebido</th>
                  <th className="px-2 py-2 text-right">Avariado</th>
                  <th className="px-2 py-2 text-right">Falta separar</th>
                  <th className="px-2 py-2 text-right">A expedir</th>
                  <th className="px-5 py-2 text-right">A receber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {(itens.dados ?? []).map((i) => (
                  <tr key={i.item_id}>
                    <td className="px-5 py-2">
                      <span className="line-clamp-1">{i.produto}</span>
                      <span className="tabular block text-xs text-suave">{i.gtin}</span>
                    </td>
                    <td className="tabular px-2 py-2 text-right">{i.qtd_pedido}</td>
                    <td className="tabular px-2 py-2 text-right">{i.qtd_separada}</td>
                    <td className="tabular px-2 py-2 text-right">{i.qtd_expedida}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold">{i.qtd_recebida}</td>
                    <td className={cx("tabular px-2 py-2 text-right", i.qtd_avariada > 0 && "font-semibold text-[#7a5200]")}>{i.qtd_avariada || "—"}</td>
                    <td className="tabular px-2 py-2 text-right">{Math.max(0, i.qtd_pedido - i.qtd_separada) || "—"}</td>
                    <td className="tabular px-2 py-2 text-right">{Math.max(0, i.qtd_pedido - i.qtd_expedida) || "—"}</td>
                    <td className="tabular px-5 py-2 text-right">{i.qtd_a_receber || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}
      </Cartao>

      {/* Histórico de divergências */}
      {(divergencias.dados ?? []).length > 0 && (
        <Cartao className="mt-4 overflow-hidden">
          <div className="border-b border-borda px-5 py-3">
            <h2 className="font-semibold">Ocorrências do recebimento</h2>
            <p className="text-xs text-suave">A PRODIGY acompanha e registra a solução. As quantidades originais não mudam.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-2">Produto</th>
                  <th className="px-2 py-2">Entrega</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2 text-right">Qtd.</th>
                  <th className="px-2 py-2">Situação</th>
                  <th className="px-5 py-2">Solução</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {(divergencias.dados ?? []).map((d) => (
                  <tr key={d.id} className={cx(!d.atual && "text-suave")}>
                    <td className="px-5 py-2">
                      <span className="line-clamp-1">{d.produto}</span>
                      <span className="tabular block text-xs text-suave">{d.gtin}</span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {d.expedicao_numero}
                      {!d.atual && <span className="block">contagem anterior</span>}
                    </td>
                    <td className="px-2 py-2">{ROTULO_TIPO[d.tipo]}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold">{d.qtd}</td>
                    <td className="px-2 py-2">
                      {d.atual || d.status === "resolvida" ? (
                        <Selo className={ROTULO_STATUS_DIVERGENCIA[d.status].classe}>{ROTULO_STATUS_DIVERGENCIA[d.status].texto}</Selo>
                      ) : (
                        <Selo className="bg-navy/8 text-suave">Substituída pela recontagem</Selo>
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs">{d.resolucao ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      <ModalConfronto entrega={confronto} aoFechar={() => setConfronto(null)} visao={visao} />
    </>
  );
}

export default function PedidoLoja() {
  const { id } = useParams();
  const { perfil } = useAuth();
  return (
    <DetalhePedidoLoja
      pedidoId={Number(id)}
      voltar="/loja"
      rotaConferir={perfil?.loja_id ? (r) => `/loja/conferir/${r}` : undefined}
      visao="loja"
    />
  );
}

export function PedidoLojaSupervisor() {
  const { lojaId, id } = useParams();
  return <DetalhePedidoLoja pedidoId={Number(id)} voltar={`/lojas-miniso/loja/${lojaId}`} />;
}
