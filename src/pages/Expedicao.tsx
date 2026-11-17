import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Download, RotateCcw, Store, Truck } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { useRemessaEscolhida } from "../lib/useRemessaEscolhida";
import { novaOperacao, rpcSegura } from "../lib/operacao";
import { baixarCsv } from "../lib/buscarTudo";
import { fmtDataHora, fmtNum, nomeLoja } from "../lib/formato";
import type { Divergencia, Expedicao as TExpedicao, Loja, PedidoLoja, Perfil, StatusDivergencia } from "../lib/tipos";
import { SeloLoja } from "../components/SeloLoja";
import { AvisoErro, Barra, Botao, Campo, Cartao, Carregando, Modal, Selecao, Selo, Titulo, Vazio, cx } from "../components/ui";
import { ROTULO_STATUS_DIVERGENCIA, ROTULO_TIPO, SeloRecebimento } from "../components/loja/comum";
import { ModalConfronto } from "./loja/PedidoLoja";

type Aba = "expedir" | "recebimentos" | "divergencias" | "lojas";
const ABAS: [Aba, string][] = [
  ["expedir", "Expedir"],
  ["recebimentos", "Recebimentos nas lojas"],
  ["divergencias", "Divergências"],
  ["lojas", "Acesso das lojas"],
];

/** Expedição (saída do CD) e acompanhamento do recebimento nas lojas. */
export default function Expedicao() {
  const [params, setParams] = useSearchParams();
  // A aba fica no estado: o seletor de remessa reescreve a URL só com ?remessa=
  const [aba, setAba] = useState<Aba>(() => (ABAS.find(([k]) => k === params.get("aba"))?.[0] ?? "expedir") as Aba);
  const { lista: remessas, escolhida, carregando } = useRemessaEscolhida(true);
  useEffect(() => {
    if (params.get("aba") !== aba && params.get("remessa")) {
      const n = new URLSearchParams(params);
      n.set("aba", aba);
      setParams(n, { replace: true });
    }
  }, [aba, params, setParams]);

  function trocarAba(a: Aba) {
    setAba(a);
    const n = new URLSearchParams(params);
    n.set("aba", a);
    setParams(n);
  }

  const precisaRemessa = aba === "expedir" || aba === "recebimentos";

  return (
    <>
      <Titulo
        titulo="Expedição"
        descricao="Registre a saída do CD por loja e acompanhe o recebimento e as divergências de cada loja."
        acoes={
          precisaRemessa && remessas.length > 0 ? (
            <Selecao
              rotulo="Remessa"
              className="w-full sm:w-72"
              value={escolhida?.id ?? ""}
              onChange={(e) => {
                const n = new URLSearchParams(params);
                n.set("remessa", e.target.value);
                setParams(n);
              }}
            >
              {remessas
                .filter((r) => r.status !== "pendente")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.codigo} · {r.status === "ativa" ? "ativa" : "concluída"}
                  </option>
                ))}
            </Selecao>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borda sm:w-fit" role="tablist" aria-label="Expedição">
        {ABAS.map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            onClick={() => trocarAba(k)}
            className={cx(
              "h-10 flex-1 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none",
              aba === k ? "bg-navy text-white" : "text-navy hover:bg-azul-claro/60",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {precisaRemessa && carregando ? (
        <Carregando />
      ) : precisaRemessa && (!escolhida || escolhida.status === "pendente") ? (
        <Cartao>
          <Vazio icone={<Truck className="size-8" />} titulo="Nenhuma remessa ativa">
            A expedição fica disponível depois que a remessa é ativada.
          </Vazio>
        </Cartao>
      ) : aba === "expedir" && escolhida ? (
        <AbaExpedir remessaId={escolhida.id} />
      ) : aba === "recebimentos" && escolhida ? (
        <AbaRecebimentos remessaId={escolhida.id} codigo={escolhida.codigo} />
      ) : aba === "divergencias" ? (
        <AbaDivergencias />
      ) : (
        <AbaLojas />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function AbaExpedir({ remessaId }: { remessaId: number }) {
  const pedidos = useConsulta<PedidoLoja[]>(
    () =>
      supabase
        .from("v_loja_pedidos")
        .select("*")
        .eq("remessa_id", remessaId)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome"),
    [remessaId],
    { tabelas: ["bips", "conferencias", "expedicoes", "recebimentos_loja"] },
  );
  const [aberto, setAberto] = useState<PedidoLoja | null>(null);
  const lista = pedidos.dados ?? [];
  const disponivel = (p: PedidoLoja) => Math.max(0, p.qtd_separada - p.qtd_expedida);

  return (
    <>
      {pedidos.erro && <AvisoErro>{pedidos.erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        <div className="border-b border-borda px-5 py-3">
          <h2 className="font-semibold">Lojas da remessa</h2>
          <p className="text-xs text-suave">
            Expedir registra a saída do que já foi separado e ainda não saiu. O que sai fica congelado como manifesto da entrega; a loja confere contra ele.
          </p>
        </div>
        {pedidos.carregando && !pedidos.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={<Store className="size-8" />} titulo="Nenhuma loja nesta remessa" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-3 py-3">Separado</th>
                  <th className="px-3 py-3 text-right">Conferido CD</th>
                  <th className="px-3 py-3 text-right">Expedido</th>
                  <th className="px-3 py-3 text-right">Pronto p/ expedir</th>
                  <th className="px-3 py-3">Entregas</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((p) => (
                  <tr key={p.pedido_id}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-3">
                        <SeloLoja numero={p.loja_numero} nome={p.loja_nome} className="size-8 text-sm" />
                        <span>
                          <span className="font-medium">{p.loja_nome}</span>
                          <span className="block text-xs text-suave">Pedido {p.pedido_nome}</span>
                        </span>
                      </span>
                    </td>
                    <td className="w-44 px-3 py-2.5">
                      <span className="tabular text-sm">
                        {fmtNum(p.qtd_separada)}/{fmtNum(p.qtd_pedido)}
                      </span>
                      <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-1" />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">
                      {p.conferencia_cd_status ? fmtNum(p.qtd_conferida_cd) : <span className="text-suave">—</span>}
                      {p.conferencia_cd_status === "em_andamento" && <span className="block text-xs text-azul-escuro">em conferência</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(p.qtd_expedida)}</td>
                    <td className={cx("tabular px-3 py-2.5 text-right font-semibold", disponivel(p) > 0 ? "text-navy" : "text-suave")}>
                      {fmtNum(disponivel(p))}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {p.expedicoes === 0 ? (
                        <span className="text-suave">nenhuma</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {p.entregas_aguardando > 0 && <Selo className="bg-amarelo-claro text-[#7a5200]">{p.entregas_aguardando} aguardando</Selo>}
                          {p.entregas_em_conferencia > 0 && <Selo className="bg-azul-claro text-azul-escuro">{p.entregas_em_conferencia} conferindo</Selo>}
                          {p.entregas_conferidas > 0 && <Selo className="bg-ciano-claro text-ciano-escuro">{p.entregas_conferidas} ok</Selo>}
                          {p.entregas_com_divergencia > 0 && <Selo className="bg-erro-claro text-erro">{p.entregas_com_divergencia} c/ divergência</Selo>}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <Link to={`/expedicao/loja/${p.loja_id}/pedidos/${p.pedido_id}`} className="mr-2 text-sm font-medium text-azul-escuro hover:underline">
                        Detalhes
                      </Link>
                      <Botao tamanho="sm" icone={<Truck className="size-4" />} disabled={disponivel(p) === 0} onClick={() => setAberto(p)}>
                        Expedir
                      </Botao>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      <ModalExpedir
        pedido={aberto}
        aoFechar={() => setAberto(null)}
        aoExpedir={() => {
          setAberto(null);
          pedidos.recarregar();
        }}
      />
    </>
  );
}

function ModalExpedir({ pedido, aoFechar, aoExpedir }: { pedido: PedidoLoja | null; aoFechar: () => void; aoExpedir: () => void }) {
  const [volumes, setVolumes] = useState("1");
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Um identificador por expedição: se a rede falhar, o retry não duplica
  const [operacao, setOperacao] = useState(novaOperacao);
  const unidades = pedido ? Math.max(0, pedido.qtd_separada - pedido.qtd_expedida) : 0;
  const naoConferido = pedido && pedido.conferencia_cd_status !== "finalizada";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!pedido) return;
    setEnviando(true);
    const { error } = await rpcSegura<number>("expedir_pedido", {
      p_pedido: pedido.pedido_id,
      p_volumes: Number(volumes),
      p_operacao: operacao,
      p_observacao: obs || null,
    });
    setEnviando(false);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    toast.success(`Expedição registrada para ${pedido.loja_nome}`);
    setOperacao(novaOperacao());
    setVolumes("1");
    setObs("");
    aoExpedir();
  }

  return (
    <Modal aberto={!!pedido} aoFechar={aoFechar} titulo={`Expedir · ${pedido ? nomeLoja(pedido.loja_nome, pedido.loja_numero) : ""}`}>
      {pedido && (
        <form onSubmit={enviar} className="space-y-4">
          <p className="text-sm text-suave">
            Sai agora o que foi separado e ainda não expedido: <strong className="text-navy">{fmtNum(unidades)} un.</strong> do pedido {pedido.pedido_nome}.
            {pedido.expedicoes > 0 && ` Esta será a entrega ${pedido.expedicoes + 1}.`}
          </p>
          {naoConferido && (
            <p className="flex items-start gap-2 rounded-xl bg-amarelo-claro px-3 py-2 text-sm text-[#7a5200]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> A conferência de saída desta loja ainda não foi finalizada.
            </p>
          )}
          <Campo
            rotulo="Volumes (caixas) que saem"
            type="number"
            min={1}
            max={9999}
            required
            value={volumes}
            onChange={(e) => setVolumes(e.target.value)}
            ajuda="Conte as caixas físicas desta entrega."
          />
          <Campo rotulo="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={300} />
          <div className="flex justify-end gap-2 pt-2">
            <Botao variante="secundario" onClick={aoFechar}>
              Cancelar
            </Botao>
            <Botao type="submit" icone={<Truck className="size-4" />} carregando={enviando} disabled={unidades === 0}>
              Registrar expedição
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function AbaRecebimentos({ remessaId, codigo }: { remessaId: number; codigo: string }) {
  const entregas = useConsulta<TExpedicao[]>(
    () =>
      supabase
        .from("v_expedicoes")
        .select("*")
        .eq("remessa_id", remessaId)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("numero"),
    [remessaId],
    { tabelas: ["expedicoes", "recebimentos_loja", "divergencias"] },
  );
  const [confronto, setConfronto] = useState<TExpedicao | null>(null);
  const [reabrir, setReabrir] = useState<TExpedicao | null>(null);
  const lista = entregas.dados ?? [];

  function exportar() {
    baixarCsv(`recebimentos-${codigo}.csv`, [
      ["Loja", "Pedido", "Entrega", "Expedida em", "Volumes", "Expedido (un.)", "Recebido (un.)", "Avariado (un.)", "Situação", "Divergências abertas"],
      ...lista.map((e) => [
        nomeLoja(e.loja_nome, e.loja_numero),
        e.pedido_nome,
        e.numero,
        fmtDataHora(e.expedida_em),
        e.volumes,
        e.qtd_expedida,
        e.qtd_integra + e.qtd_avariada,
        e.qtd_avariada,
        e.recebimento_status,
        e.divergencias_abertas,
      ]),
    ]);
  }

  return (
    <>
      {entregas.erro && <AvisoErro>{entregas.erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda px-5 py-3">
          <h2 className="font-semibold">Entregas desta remessa</h2>
          <Botao variante="secundario" tamanho="sm" icone={<Download className="size-4" />} onClick={exportar} disabled={!lista.length}>
            Exportar CSV
          </Botao>
        </div>
        {entregas.carregando && !entregas.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={<Truck className="size-8" />} titulo="Nada expedido nesta remessa ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-3 py-3">Entrega</th>
                  <th className="px-3 py-3 text-right">Expedido</th>
                  <th className="px-3 py-3 text-right">Recebido</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-3">
                        <SeloLoja numero={e.loja_numero} nome={e.loja_nome} className="size-8 text-sm" />
                        <span>
                          <span className="font-medium">{e.loja_nome}</span>
                          <span className="block text-xs text-suave">Pedido {e.pedido_nome}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {e.numero}ª · {e.volumes} vol.
                      <span className="block text-xs text-suave">{fmtDataHora(e.expedida_em)}</span>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(e.qtd_expedida)}</td>
                    <td className="tabular px-3 py-2.5 text-right">
                      {e.recebimento_status === "aguardando" ? "—" : fmtNum(e.qtd_integra + e.qtd_avariada)}
                      {e.qtd_avariada > 0 && <span className="block text-xs text-[#7a5200]">{e.qtd_avariada} avariadas</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <SeloRecebimento status={e.recebimento_status} />
                      {e.divergencias_abertas > 0 && <span className="block text-xs text-erro">{e.divergencias_abertas} divergências abertas</span>}
                      {e.revisao > 1 && <span className="block text-xs text-suave">recontagem {e.revisao}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {e.recebimento_status !== "aguardando" && (
                        <Botao variante="fantasma" tamanho="sm" onClick={() => setConfronto(e)}>
                          Ver confronto
                        </Botao>
                      )}
                      {(e.recebimento_status === "recebido_conferido" || e.recebimento_status === "recebido_com_divergencia") && (
                        <Botao variante="secundario" tamanho="sm" icone={<RotateCcw className="size-4" />} onClick={() => setReabrir(e)}>
                          Reabrir
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
      <ModalConfronto entrega={confronto} aoFechar={() => setConfronto(null)} />
      <ModalMotivo
        aberto={!!reabrir}
        titulo={`Reabrir recebimento · ${reabrir ? nomeLoja(reabrir.loja_nome, reabrir.loja_numero) : ""}`}
        texto="A loja vai poder contar de novo. A contagem anterior e as divergências dela ficam no histórico."
        rotulo="Motivo da reabertura"
        botao="Reabrir para nova contagem"
        aoFechar={() => setReabrir(null)}
        aoConfirmar={async (motivo) => {
          if (!reabrir) return false;
          const { error } = await supabase.rpc("reabrir_recebimento_loja", { p_recebimento: reabrir.recebimento_id, p_motivo: motivo });
          if (error) {
            toast.error(mensagemErro(error));
            return false;
          }
          toast.success("Recebimento reaberto");
          setReabrir(null);
          entregas.recarregar();
          return true;
        }}
      />
    </>
  );
}

function ModalMotivo({
  aberto,
  titulo,
  texto,
  rotulo,
  botao,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean;
  titulo: string;
  texto: string;
  rotulo: string;
  botao: string;
  aoFechar: () => void;
  aoConfirmar: (texto: string) => Promise<boolean>;
}) {
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={titulo}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setEnviando(true);
          const ok = await aoConfirmar(valor.trim());
          setEnviando(false);
          if (ok) setValor("");
        }}
        className="space-y-4"
      >
        <p className="text-sm text-suave">{texto}</p>
        <Campo rotulo={rotulo} required value={valor} onChange={(e) => setValor(e.target.value)} maxLength={500} autoFocus />
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit" carregando={enviando} disabled={!valor.trim()}>
            {botao}
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function AbaDivergencias() {
  const [filtro, setFiltro] = useState<StatusDivergencia | "pendentes" | "todas">("pendentes");
  const divergencias = useConsulta<Divergencia[]>(
    () => {
      let q = supabase.from("v_divergencias").select("*").eq("atual", true).order("criada_em", { ascending: false }).limit(1000);
      if (filtro === "pendentes") q = q.neq("status", "resolvida");
      else if (filtro !== "todas") q = q.eq("status", filtro);
      return q;
    },
    [filtro],
    { tabelas: ["divergencias"] },
  );
  const [resolver, setResolver] = useState<Divergencia | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const lista = divergencias.dados ?? [];
  const porLoja = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of lista) m.set(nomeLoja(d.loja_nome, d.loja_numero), (m.get(nomeLoja(d.loja_nome, d.loja_numero)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lista]);

  async function emAnalise(d: Divergencia) {
    setOcupado(d.id);
    const { error } = await supabase.rpc("atualizar_divergencia", { p_divergencia: d.id, p_status: "em_analise" });
    setOcupado(null);
    if (error) toast.error(mensagemErro(error));
    else divergencias.recarregar();
  }

  function exportar() {
    baixarCsv("divergencias-lojas.csv", [
      ["Loja", "Remessa", "Pedido", "Entrega", "GTIN", "Produto", "Tipo", "Expedido", "Recebido", "Avariado", "Qtd.", "Situação", "Solução"],
      ...lista.map((d) => [
        nomeLoja(d.loja_nome, d.loja_numero),
        d.remessa_codigo,
        d.pedido_nome,
        d.expedicao_numero,
        d.gtin,
        d.produto,
        ROTULO_TIPO[d.tipo],
        d.qtd_expedida,
        d.qtd_recebida,
        d.qtd_avariada,
        d.qtd,
        ROTULO_STATUS_DIVERGENCIA[d.status].texto,
        d.resolucao,
      ]),
    ]);
  }

  return (
    <>
      {divergencias.erro && <AvisoErro>{divergencias.erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-borda px-5 py-3">
          <div>
            <h2 className="font-semibold">Divergências do recebimento nas lojas</h2>
            <p className="text-xs text-suave">
              {porLoja.length ? porLoja.map(([l, n]) => `${l}: ${n}`).join(" · ") : "Contagem atual de cada entrega."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Selecao value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Situação">
              <option value="pendentes">Abertas e em análise</option>
              <option value="aberta">Abertas</option>
              <option value="em_analise">Em análise</option>
              <option value="resolvida">Resolvidas</option>
              <option value="todas">Todas</option>
            </Selecao>
            <Botao variante="secundario" icone={<Download className="size-4" />} onClick={exportar} disabled={!lista.length}>
              CSV
            </Botao>
          </div>
        </div>
        {divergencias.carregando && !divergencias.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={<AlertTriangle className="size-8" />} titulo="Nenhuma divergência aqui" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Loja</th>
                  <th className="px-3 py-3">Produto</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3 text-right">Exp. / Rec. / Avar.</th>
                  <th className="px-3 py-3 text-right">Qtd.</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{nomeLoja(d.loja_nome, d.loja_numero)}</span>
                      <span className="block text-xs text-suave">
                        Pedido {d.pedido_nome} · entrega {d.expedicao_numero}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="line-clamp-1">{d.produto}</span>
                      <span className="tabular block text-xs text-suave">{d.gtin}</span>
                    </td>
                    <td className="px-3 py-2.5">{ROTULO_TIPO[d.tipo]}</td>
                    <td className="tabular px-3 py-2.5 text-right text-suave">
                      {d.qtd_expedida} / {d.qtd_recebida} / {d.qtd_avariada}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right font-semibold">{d.qtd}</td>
                    <td className="px-3 py-2.5">
                      <Selo className={ROTULO_STATUS_DIVERGENCIA[d.status].classe}>{ROTULO_STATUS_DIVERGENCIA[d.status].texto}</Selo>
                      {d.resolucao && <span className="block max-w-56 truncate text-xs text-suave" title={d.resolucao}>{d.resolucao}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {d.status === "aberta" && (
                        <Botao variante="fantasma" tamanho="sm" carregando={ocupado === d.id} onClick={() => emAnalise(d)}>
                          Em análise
                        </Botao>
                      )}
                      {d.status !== "resolvida" && (
                        <Botao variante="secundario" tamanho="sm" onClick={() => setResolver(d)}>
                          Resolver
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
      <ModalMotivo
        aberto={!!resolver}
        titulo={`Resolver · ${resolver ? ROTULO_TIPO[resolver.tipo] : ""} de ${resolver?.qtd ?? ""} un.`}
        texto="Descreva o que foi feito (ex.: reenvio, crédito, acerto de estoque). As quantidades registradas não mudam."
        rotulo="Solução"
        botao="Marcar como resolvida"
        aoFechar={() => setResolver(null)}
        aoConfirmar={async (texto) => {
          if (!resolver) return false;
          const { error } = await supabase.rpc("atualizar_divergencia", { p_divergencia: resolver.id, p_status: "resolvida", p_resolucao: texto });
          if (error) {
            toast.error(mensagemErro(error));
            return false;
          }
          toast.success("Divergência resolvida");
          setResolver(null);
          divergencias.recarregar();
          return true;
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
function AbaLojas() {
  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*").order("numero", { ascending: true, nullsFirst: false }).order("nome"), []);
  const usuarios = useConsulta<Perfil[]>(() => supabase.from("perfis").select("*").not("loja_id", "is", null), []);
  const [mudando, setMudando] = useState<number | null>(null);

  async function alternar(l: Loja) {
    setMudando(l.id);
    const { error } = await supabase.from("lojas").update({ modulo_loja: !l.modulo_loja }).eq("id", l.id);
    setMudando(null);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    toast.success(l.modulo_loja ? `Acesso de ${l.nome} desligado` : `Acesso de ${l.nome} habilitado`);
    lojas.recarregar();
  }

  return (
    <Cartao className="overflow-hidden">
      <div className="border-b border-borda px-5 py-3">
        <h2 className="font-semibold">Acesso das lojas</h2>
        <p className="text-xs text-suave">
          Com o acesso habilitado, os usuários vinculados à loja (cadastrados em Usuários) entram no painel e conferem o recebimento. Desligar corta o acesso
          na hora, sem apagar nada.
        </p>
      </div>
      {lojas.erro && <AvisoErro>{lojas.erro}</AvisoErro>}
      {lojas.carregando && !lojas.dados ? (
        <Carregando />
      ) : (
        <ul className="divide-y divide-borda">
          {(lojas.dados ?? []).map((l) => {
            const vinculados = (usuarios.dados ?? []).filter((u) => u.loja_id === l.id);
            const ativos = vinculados.filter((u) => u.ativo).length;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <SeloLoja numero={l.numero} nome={l.nome} className="size-9 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.nome}</p>
                  <p className="text-xs text-suave">
                    {vinculados.length === 0
                      ? "Nenhum usuário da loja cadastrado"
                      : `${ativos} ${ativos === 1 ? "usuário ativo" : "usuários ativos"}: ${vinculados.map((u) => u.nome).join(", ")}`}
                  </p>
                </div>
                <Link to={`/expedicao/loja/${l.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-azul-escuro hover:underline">
                  Ver painel <ArrowRight className="size-3.5" />
                </Link>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[#00877b]"
                    checked={!!l.modulo_loja}
                    disabled={mudando === l.id}
                    onChange={() => alternar(l)}
                  />
                  {l.modulo_loja ? "Habilitado" : "Desligado"}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
