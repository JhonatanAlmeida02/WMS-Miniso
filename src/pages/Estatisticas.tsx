import { useMemo, useState, type ReactNode } from "react";
import { ChartColumn, Clock, Gauge, Timer, TriangleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum, nomeLoja } from "../lib/formato";
import type { Remessa } from "../lib/tipos";
import { SeloLoja } from "../components/SeloLoja";
import { Barra, Cartao, Carregando, Selecao, Titulo, Vazio, cx } from "../components/ui";

interface Estatisticas {
  resumo: {
    bips: number;
    unidades: number;
    ajustes: number;
    operadores: number;
    itens: number;
    lojas: number;
    primeiro: string | null;
    ultimo: string | null;
    ativo_seg: number;
    intervalos: number;
  };
  operadores: {
    operador_id: string | null;
    nome: string;
    bips: number;
    unidades: number;
    ajustes: number;
    primeiro: string;
    ultimo: string;
    ativo_seg: number;
    intervalos: number;
    lojas: number;
    itens: number;
  }[];
  horas: { hora: string; unidades: number; bips: number; operadores: number }[];
  lojas: {
    pedido_id: number;
    nome: string;
    numero: number | null;
    primeiro: string;
    ultimo: string;
    unidades: number;
    qtd_pedido: number;
    qtd_separada: number;
  }[];
  conferencia: { conferencias: number; finalizadas: number; tempo_medio_seg: number | null };
}

type Periodo = "tudo" | "hoje" | "ontem" | "7dias";

function intervalo(p: Periodo): [string | null, string | null] {
  if (p === "tudo") return [null, null];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = 86400000;
  if (p === "hoje") return [hoje.toISOString(), null];
  if (p === "ontem") return [new Date(hoje.getTime() - dia).toISOString(), hoje.toISOString()];
  return [new Date(hoje.getTime() - 6 * dia).toISOString(), null];
}

/** 3725 s -> "1 h 02 min" */
function fmtDuracao(seg: number | null | undefined) {
  if (seg == null || !Number.isFinite(seg)) return "—";
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
const dhm = (iso: string | null) =>
  iso ? `${new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm(iso)}` : "—";

const porMinuto = (unidades: number, seg: number) => (seg > 0 ? unidades / (seg / 60) : null);
const fmtDec = (n: number | null, casas = 1) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function Indicador({
  icone,
  rotulo,
  valor,
  detalhe,
}: {
  icone: ReactNode;
  rotulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <Cartao className="p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm text-suave">
        <span className="text-azul" aria-hidden>
          {icone}
        </span>
        {rotulo}
      </p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-suave">{detalhe}</p>}
    </Cartao>
  );
}

/** Colunas de unidades por hora (uma série só: sem legenda, o título diz o que é). */
function GraficoHoras({ horas }: { horas: Estatisticas["horas"] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const max = Math.max(1, ...horas.map((h) => h.unidades));
  // eixo em números redondos
  const passo = Math.pow(10, Math.floor(Math.log10(max)));
  const topo = Math.ceil(max / passo) * passo;
  const ticks = [0, topo / 2, topo];
  const rotulo = (h: string) => h.slice(11, 13) + "h";
  const dia = (h: string) => `${h.slice(8, 10)}/${h.slice(5, 7)}`;
  const variosDias = new Set(horas.map((h) => h.hora.slice(0, 10))).size > 1;

  return (
    <Cartao className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Unidades separadas por hora</h2>
          <p className="text-xs text-suave">Horário de Brasília</p>
        </div>
        <button type="button" onClick={() => setTabela((t) => !t)} className="text-sm font-medium text-azul-escuro hover:underline">
          {tabela ? "Ver gráfico" : "Ver tabela"}
        </button>
      </div>
      {tabela ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-suave uppercase">
            <tr>
              <th className="py-1.5">Hora</th>
              <th className="py-1.5 text-right">Unidades</th>
              <th className="py-1.5 text-right">Bips</th>
              <th className="py-1.5 text-right">Operadores</th>
            </tr>
          </thead>
          <tbody className="tabular divide-y divide-borda">
            {horas.map((h) => (
              <tr key={h.hora}>
                <td className="py-1.5">
                  {variosDias && `${dia(h.hora)} `}
                  {rotulo(h.hora)}
                </td>
                <td className="py-1.5 text-right font-medium">{fmtNum(h.unidades)}</td>
                <td className="py-1.5 text-right">{fmtNum(h.bips)}</td>
                <td className="py-1.5 text-right">{h.operadores}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2">
          {/* eixo y */}
          <div className="tabular relative h-48 w-10 shrink-0 text-right text-xs text-suave">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / topo) * 100}%` }}>
                {t >= 10000 ? `${Math.round(t / 1000)}K` : fmtNum(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="relative h-48" style={{ minWidth: `${horas.length * 30}px` }}>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-borda" style={{ top: `${100 - (t / topo) * 100}%` }} aria-hidden />
              ))}
              <div className="absolute inset-0 flex items-end gap-0.5" role="list" aria-label="Unidades por hora">
                {horas.map((h, i) => (
                  <div
                    key={h.hora}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${rotulo(h.hora)}: ${h.unidades} unidades`}
                    className="relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                    onMouseEnter={() => setFoco(i)}
                    onMouseLeave={() => setFoco(null)}
                    onFocus={() => setFoco(i)}
                    onBlur={() => setFoco(null)}
                  >
                    <div
                      className={cx("w-full max-w-6 rounded-t-[4px] transition-colors", foco === i ? "bg-navy" : "bg-azul")}
                      style={{ height: `${Math.max(h.unidades > 0 ? 1 : 0, (h.unidades / topo) * 100)}%` }}
                    />
                    {foco === i && (
                      <div className="tabular pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-lg bg-navy px-3 py-2 text-xs text-white shadow-lg">
                        <p className="font-semibold">
                          {variosDias && `${dia(h.hora)} `}
                          {rotulo(h.hora)}
                        </p>
                        <p>{fmtNum(h.unidades)} unidades</p>
                        <p className="text-white/70">
                          {fmtNum(h.bips)} bips · {h.operadores} {h.operadores === 1 ? "operador" : "operadores"}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="tabular mt-1 flex gap-0.5 text-xs text-suave" style={{ minWidth: `${horas.length * 30}px` }}>
              {horas.map((h) => (
                <span key={h.hora} className="flex-1 text-center">
                  {rotulo(h.hora)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Cartao>
  );
}

export default function EstatisticasPagina() {
  const remessas = useConsulta<Remessa[]>(
    () => supabase.from("v_remessas").select("*").neq("status", "pendente").order("criado_em", { ascending: false }).limit(100),
    [],
  );
  const [remessaSel, setRemessaSel] = useState<string>("");
  const [periodo, setPeriodo] = useState<Periodo>("tudo");

  const lista = remessas.dados ?? [];
  const padrao = lista.find((r) => r.status === "ativa") ?? lista[0];
  const remessaId = remessaSel === "todas" ? null : Number(remessaSel || padrao?.id) || null;
  const [inicio, fim] = intervalo(remessaSel === "todas" && periodo === "tudo" ? "7dias" : periodo);

  const est = useConsulta<Estatisticas>(
    () => supabase.rpc("estatisticas_separacao", { p_remessa: remessaId, p_inicio: inicio, p_fim: fim }),
    [remessaId, inicio, fim],
    { tabelas: ["bips"], ativo: !remessas.carregando, atraso: 5000 },
  );

  const d = est.dados;
  const calc = useMemo(() => {
    if (!d) return null;
    const r = d.resumo;
    const relogio = r.primeiro && r.ultimo ? (new Date(r.ultimo).getTime() - new Date(r.primeiro).getTime()) / 1000 : 0;
    const ops = d.operadores
      .map((o) => ({
        ...o,
        porMin: porMinuto(o.unidades, o.ativo_seg),
        segPorUn: o.unidades > 0 && o.ativo_seg > 0 ? o.ativo_seg / o.unidades : null,
        mediaEntreBips: o.intervalos > 0 ? o.ativo_seg / o.intervalos : null,
      }))
      .sort((a, b) => (b.porMin ?? -1) - (a.porMin ?? -1));
    return {
      relogio,
      porMin: porMinuto(r.unidades, r.ativo_seg),
      segPorUn: r.unidades > 0 && r.ativo_seg > 0 ? r.ativo_seg / r.unidades : null,
      mediaEntreBips: r.intervalos > 0 ? r.ativo_seg / r.intervalos : null,
      ops,
      maxPorMin: Math.max(0.001, ...ops.map((o) => o.porMin ?? 0)),
    };
  }, [d]);

  return (
    <>
      <Titulo titulo="Estatísticas" descricao="Ritmo da separação: tempo, média e produtividade por operador, hora e loja." />

      {/* filtros numa linha só */}
      <Cartao className="mb-5 flex flex-wrap items-end gap-3 p-4">
        <Selecao rotulo="Remessa" className="min-w-56 flex-1" value={remessaSel || String(padrao?.id ?? "")} onChange={(e) => setRemessaSel(e.target.value)}>
          {lista.map((r) => (
            <option key={r.id} value={r.id}>
              {r.codigo} · {r.status === "ativa" ? "ativa" : "concluída"}
            </option>
          ))}
          <option value="todas">Todas as remessas</option>
        </Selecao>
        <Selecao rotulo="Período" className="w-full sm:w-52" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="tudo">{remessaSel === "todas" ? "Últimos 7 dias" : "Toda a remessa"}</option>
          <option value="hoje">Hoje</option>
          <option value="ontem">Ontem</option>
          <option value="7dias">Últimos 7 dias</option>
        </Selecao>
      </Cartao>

      {remessas.carregando || (est.carregando && !d) ? (
        <Carregando />
      ) : !d || !calc || d.resumo.bips === 0 ? (
        <Cartao>
          <Vazio icone={<ChartColumn className="size-8" />} titulo="Nenhum bip neste filtro">
            As estatísticas aparecem assim que os operadores começarem a separar.
          </Vazio>
        </Cartao>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador
              icone={<Clock className="size-4" />}
              rotulo="Tempo de separação"
              valor={fmtDuracao(calc.relogio)}
              detalhe={`${dhm(d.resumo.primeiro)} → ${dhm(d.resumo.ultimo)}`}
            />
            <Indicador
              icone={<Timer className="size-4" />}
              rotulo="Tempo ativo da equipe"
              valor={fmtDuracao(d.resumo.ativo_seg)}
              detalhe="Soma de todos; pausas de mais de 5 min não contam"
            />
            <Indicador
              icone={<Gauge className="size-4" />}
              rotulo="Unidades por minuto"
              valor={fmtDec(calc.porMin)}
              detalhe={`por operador ativo · ${fmtDec(calc.segPorUn)} s por unidade`}
            />
            <Indicador
              icone={<ChartColumn className="size-4" />}
              rotulo="Unidades separadas"
              valor={fmtNum(d.resumo.unidades)}
              detalhe={`${fmtNum(d.resumo.bips)} bips · ${d.resumo.operadores} ${d.resumo.operadores === 1 ? "operador" : "operadores"} · ${d.resumo.lojas} lojas`}
            />
          </div>

          {/* Ranking por operador */}
          <Cartao className="overflow-hidden">
            <div className="border-b border-borda px-5 py-4">
              <h2 className="font-semibold">Produtividade por operador</h2>
              <p className="text-xs text-suave">Unidades por minuto de tempo ativo; pausas de mais de 5 min entre bips não contam.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                  <tr>
                    <th className="px-5 py-3">Operador</th>
                    <th className="w-[28%] px-3 py-3">Unidades / min</th>
                    <th className="px-3 py-3 text-right">Unidades</th>
                    <th className="px-3 py-3 text-right">Tempo ativo</th>
                    <th className="px-3 py-3 text-right">Seg. / unidade</th>
                    <th className="px-3 py-3 text-right">Média entre bips</th>
                    <th className="px-3 py-3 text-right">Ajustes</th>
                    <th className="px-5 py-3 text-right">Lojas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {calc.ops.map((o) => (
                    <tr key={o.operador_id ?? o.nome}>
                      <td className="px-5 py-3">
                        <span className="font-medium">{o.nome}</span>
                        <span className="tabular block text-xs text-suave">
                          {hm(o.primeiro)} – {hm(o.ultimo)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-3 flex-1">
                            <div className="h-3 rounded-r-[4px] bg-azul" style={{ width: `${((o.porMin ?? 0) / calc.maxPorMin) * 100}%` }} />
                          </div>
                          <span className="tabular w-10 text-right font-semibold">{fmtDec(o.porMin)}</span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-3 text-right">{fmtNum(o.unidades)}</td>
                      <td className="tabular px-3 py-3 text-right">{fmtDuracao(o.ativo_seg)}</td>
                      <td className="tabular px-3 py-3 text-right">{fmtDec(o.segPorUn)}</td>
                      <td className="tabular px-3 py-3 text-right">{o.mediaEntreBips == null ? "—" : `${fmtDec(o.mediaEntreBips)} s`}</td>
                      <td className="tabular px-3 py-3 text-right">
                        {o.ajustes > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#7a5200]">
                            <TriangleAlert className="size-3.5" aria-hidden /> {o.ajustes}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="tabular px-5 py-3 text-right">{o.lojas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <GraficoHoras horas={d.horas} />

            <Cartao className="p-5">
              <h2 className="font-semibold">Conferência física</h2>
              <p className="text-xs text-suave">Rebipagem das caixas no mesmo filtro</p>
              <dl className="tabular mt-4 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-suave">Lojas conferidas</dt>
                  <dd className="text-2xl font-semibold">{d.conferencia.finalizadas}</dd>
                </div>
                <div>
                  <dt className="text-xs text-suave">Tempo médio por loja</dt>
                  <dd className="text-2xl font-semibold">{fmtDuracao(d.conferencia.tempo_medio_seg)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-suave">Média entre bips (separação)</dt>
                  <dd className="text-2xl font-semibold">{calc.mediaEntreBips == null ? "—" : `${fmtDec(calc.mediaEntreBips)} s`}</dd>
                </div>
                <div>
                  <dt className="text-xs text-suave">Ajustes / estornos</dt>
                  <dd className="text-2xl font-semibold">
                    {d.resumo.ajustes}
                    <span className="ml-1 text-sm font-normal text-suave">
                      ({fmtDec(d.resumo.bips ? (d.resumo.ajustes / d.resumo.bips) * 100 : 0)}% dos bips)
                    </span>
                  </dd>
                </div>
              </dl>
            </Cartao>
          </div>

          {/* Por loja */}
          <Cartao className="overflow-hidden">
            <div className="border-b border-borda px-5 py-4">
              <h2 className="font-semibold">Tempo por loja</h2>
              <p className="text-xs text-suave">Do primeiro ao último bip de cada loja, no filtro escolhido</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                  <tr>
                    <th className="px-5 py-3">Loja</th>
                    <th className="w-[30%] px-3 py-3">Separado do pedido</th>
                    <th className="px-3 py-3 text-right">Início</th>
                    <th className="px-3 py-3 text-right">Último bip</th>
                    <th className="px-5 py-3 text-right">Duração</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {d.lojas.map((l) => (
                    <tr key={l.pedido_id}>
                      <td className="px-5 py-2.5">
                        <span className="flex items-center gap-3">
                          <SeloLoja numero={l.numero} nome={l.nome} className="size-8 text-sm" />
                          <span className="font-medium">{nomeLoja(l.nome, null)}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Barra parte={l.qtd_separada} total={l.qtd_pedido} />
                          <span className="tabular w-24 shrink-0 text-right text-xs">
                            {fmtNum(l.qtd_separada)}/{fmtNum(l.qtd_pedido)}
                          </span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{dhm(l.primeiro)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{dhm(l.ultimo)}</td>
                      <td className="tabular px-5 py-2.5 text-right font-medium">
                        {fmtDuracao((new Date(l.ultimo).getTime() - new Date(l.primeiro).getTime()) / 1000)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </div>
      )}
    </>
  );
}
