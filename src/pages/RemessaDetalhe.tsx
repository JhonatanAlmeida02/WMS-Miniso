import { Fragment, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckCheck, ChevronDown, ClipboardCheck, Pause, Play, Trash2, Waypoints } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { alterarStatus, excluirRemessa } from "../lib/remessa";
import { fmtData, fmtDataHora, fmtNum, fmtPct, nomeLoja } from "../lib/formato";
import type { ItemPedido, PedidoResumo, Remessa } from "../lib/tipos";
import {
  AvisoErro,
  Barra,
  Botao,
  Cartao,
  Carregando,
  SeloStatus,
  Titulo,
  classesBotao,
  cx,
  useConfirmacao,
} from "../components/ui";

function ItensDoPedido({ pedidoId }: { pedidoId: number }) {
  const { dados } = useConsulta<ItemPedido[]>(
    () => supabase.from("itens_pedido").select("*").eq("pedido_id", pedidoId).order("produto"),
    [pedidoId],
    { tabelas: ["itens_pedido"] },
  );
  if (!dados) return <p className="px-5 py-3 text-sm text-suave">Carregando itens…</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-borda/70">
        {dados.map((i) => (
          <tr key={i.id}>
            <td className="py-2 pr-3 pl-10">
              {i.produto}
              <span className="tabular block text-xs text-suave">{i.gtin}</span>
            </td>
            <td className={cx("tabular px-5 py-2 text-right font-medium", i.qtd_separada === i.qtd_pedido ? "text-ciano-escuro" : i.qtd_separada > 0 ? "text-navy" : "text-suave")}>
              {i.qtd_separada}/{i.qtd_pedido}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RemessaDetalhe() {
  const { id } = useParams();
  const remessaId = Number(id);
  const navegar = useNavigate();
  const [confirmar, dialogo] = useConfirmacao();
  const [aberto, setAberto] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const remessa = useConsulta<Remessa>(
    () => supabase.from("v_remessas").select("*").eq("id", remessaId).single(),
    [remessaId],
    { tabelas: ["remessas", "itens_pedido", "pedidos"] },
  );
  const pedidos = useConsulta<PedidoResumo[]>(
    () =>
      supabase
        .from("v_pedidos")
        .select("*")
        .eq("remessa_id", remessaId)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome")
        .order("nome"),
    [remessaId],
    { tabelas: ["itens_pedido", "pedidos"] },
  );

  if (remessa.erro) return <AvisoErro>{remessa.erro}</AvisoErro>;
  if (!remessa.dados) return <Carregando />;
  const r = remessa.dados;
  const lista = pedidos.dados ?? [];
  const completos = lista.filter((p) => p.qtd_separada >= p.qtd_pedido).length;

  async function mudar(status: Remessa["status"]) {
    if (status === "concluida" && r.qtd_separada < r.qtd_pedido) {
      const ok = await confirmar({
        titulo: "Concluir com divergência?",
        mensagem: (
          <>
            Faltam <strong>{fmtNum(r.qtd_pedido - r.qtd_separada)}</strong> unidades para fechar esta remessa. Ao concluir, ela
            sai da tela dos operadores. Confira antes na Conferência.
          </>
        ),
        confirmar: "Concluir mesmo assim",
        perigo: true,
      });
      if (!ok) return;
    }
    if (status === "ativa" && r.pedidos_sem_operador > 0) {
      const ok = await confirmar({
        titulo: "Ativar com pedidos sem operador?",
        mensagem: `${r.pedidos_sem_operador} pedidos ainda não têm operador e não vão aparecer para ninguém até serem distribuídos.`,
        confirmar: "Ativar assim mesmo",
      });
      if (!ok) return;
    }
    setOcupado(true);
    await alterarStatus(r.id, status);
    setOcupado(false);
    remessa.recarregar();
  }

  async function excluir() {
    const ok = await confirmar({
      titulo: `Excluir a remessa ${r.codigo}?`,
      mensagem: "Pedidos e itens desta remessa serão apagados. Só é possível enquanto ninguém bipou nada nela.",
      confirmar: "Excluir remessa",
      perigo: true,
    });
    if (!ok) return;
    setOcupado(true);
    const feito = await excluirRemessa(r.id);
    setOcupado(false);
    if (feito) navegar("/remessas");
  }

  return (
    <>
      {dialogo}
      <Link to="/remessas" className="mb-3 inline-flex items-center gap-1 text-sm text-suave hover:text-navy">
        <ArrowLeft className="size-4" /> Remessas
      </Link>
      <Titulo
        titulo={`Remessa ${r.codigo}`}
        descricao={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SeloStatus status={r.status} />
            <span>Chegada {fmtData(r.data_chegada)}</span>
            {r.total_caixas != null && <span>{fmtNum(r.total_caixas)} caixas</span>}
            <span>
              Importada {fmtDataHora(r.criado_em)}
              {r.criado_por_nome && ` por ${r.criado_por_nome}`}
            </span>
          </span>
        }
        acoes={
          <>
            <Link to={`/distribuicao?remessa=${r.id}`} className={classesBotao("secundario")}>
              <Waypoints className="size-4" aria-hidden /> Distribuir
            </Link>
            <Link to={`/conferencia?remessa=${r.id}`} className={classesBotao("secundario")}>
              <ClipboardCheck className="size-4" aria-hidden /> Conferência
            </Link>
            {r.status === "pendente" && (
              <>
                <Botao variante="perigo" icone={<Trash2 className="size-4" />} onClick={excluir} disabled={ocupado}>
                  Excluir
                </Botao>
                <Botao variante="azul" icone={<Play className="size-4" />} onClick={() => mudar("ativa")} carregando={ocupado}>
                  Ativar
                </Botao>
              </>
            )}
            {r.status === "ativa" && (
              <>
                <Botao variante="secundario" icone={<Pause className="size-4" />} onClick={() => mudar("pendente")} disabled={ocupado}>
                  Pausar
                </Botao>
                <Botao variante="sucesso" icone={<CheckCheck className="size-4" />} onClick={() => mudar("concluida")} carregando={ocupado}>
                  Concluir
                </Botao>
              </>
            )}
            {r.status === "concluida" && (
              <Botao variante="secundario" icone={<Play className="size-4" />} onClick={() => mudar("ativa")} carregando={ocupado}>
                Reabrir
              </Botao>
            )}
          </>
        }
      />

      {r.observacao && <p className="-mt-3 mb-5 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-borda">{r.observacao}</p>}

      <Cartao className="mb-6 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-suave">Separado</p>
            <p className="tabular text-3xl font-semibold">{fmtPct(r.qtd_separada, r.qtd_pedido)}</p>
          </div>
          <dl className="tabular grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-suave">Unidades</dt>
              <dd className="font-semibold">
                {fmtNum(r.qtd_separada)} / {fmtNum(r.qtd_pedido)}
              </dd>
            </div>
            <div>
              <dt className="text-suave">Pedidos completos</dt>
              <dd className="font-semibold">
                {completos} / {r.pedidos}
              </dd>
            </div>
            <div>
              <dt className="text-suave">Lojas</dt>
              <dd className="font-semibold">{r.lojas}</dd>
            </div>
            <div>
              <dt className="text-suave">Sem operador</dt>
              <dd className={cx("font-semibold", r.pedidos_sem_operador > 0 && "text-[#7a5200]")}>{r.pedidos_sem_operador}</dd>
            </div>
          </dl>
        </div>
        <Barra parte={r.qtd_separada} total={r.qtd_pedido} className="mt-4 h-3" />
      </Cartao>

      <Cartao className="overflow-hidden">
        <div className="border-b border-borda px-5 py-4">
          <h2 className="font-semibold">Pedidos</h2>
        </div>
        {!pedidos.dados ? (
          <Carregando />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-3 py-3">Pedido</th>
                  <th className="px-3 py-3">Operador</th>
                  <th className="px-3 py-3 text-right">Itens</th>
                  <th className="w-56 px-5 py-3">Separado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="cursor-pointer hover:bg-fundo/60" onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                      <td className="px-5 py-3 font-medium">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 text-left"
                          aria-expanded={aberto === p.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAberto(aberto === p.id ? null : p.id);
                          }}
                        >
                          <ChevronDown className={cx("size-4 text-suave transition-transform", aberto === p.id && "rotate-180")} aria-hidden />
                          {nomeLoja(p.loja_nome, p.loja_numero)}
                        </button>
                      </td>
                      <td className="px-3 py-3">{p.nome}</td>
                      <td className="px-3 py-3">
                        {p.operador_nome ?? <span className="font-medium text-[#7a5200]">Sem operador</span>}
                      </td>
                      <td className="tabular px-3 py-3 text-right">
                        {p.itens_completos}/{p.itens}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Barra parte={p.qtd_separada} total={p.qtd_pedido} />
                          <span className="tabular w-20 text-right text-xs">
                            {fmtNum(p.qtd_separada)}/{fmtNum(p.qtd_pedido)}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {aberto === p.id && (
                      <tr className="bg-fundo/50">
                        <td colSpan={5} className="p-0">
                          <ItensDoPedido pedidoId={p.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}
