import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCheck,
  ClipboardCheck,
  History,
  LoaderCircle,
  LogOut,
  RotateCcw,
  ScanBarcode,
  Undo2,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { useLeitor } from "../lib/useLeitor";
import { useRemessaEscolhida } from "../lib/useRemessaEscolhida";
import { fmtNum, fmtPct, tempoRelativo } from "../lib/formato";
import { somAviso, somErro, somOk, vibrar } from "../lib/som";
import type { ConferenciaLoja, LinhaConfronto, StatusConferencia } from "../lib/tipos";
import { Logo } from "../components/Logo";
import { SeloLoja } from "../components/SeloLoja";
import { Confronto, ROTULO_SITUACAO, contarSituacoes } from "../components/Confronto";
import { Barra, Botao, Carregando, Modal, Selecao, Vazio, cx } from "../components/ui";
import { ChaveModoRapido, QuantidadeLeitura, qtdValida, useModoRapido } from "../components/QuantidadeLeitura";

interface Leitura {
  id: number;
  gtin: string;
  produto: string;
  qtd: number;
  linha: LinhaConfronto;
  hora: Date;
}

/** Situação da conferência de uma loja, para a lista. */
function SituacaoLoja({ l }: { l: ConferenciaLoja }) {
  if (!l.status) return <span className="text-xs font-medium text-suave">Não conferida</span>;
  if (l.status === "em_andamento")
    return (
      <span className="text-xs font-semibold text-azul-escuro">
        Em andamento · {l.bips > 0 ? `${l.bips} ${l.bips === 1 ? "leitura" : "leituras"}` : "nenhuma leitura ainda"}
      </span>
    );
  return l.divergencias ? (
    <span className="text-xs font-semibold text-erro">
      {l.divergencias} {l.divergencias === 1 ? "divergência" : "divergências"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-ciano-escuro">
      <CheckCheck className="size-3.5" /> Conferida OK
    </span>
  );
}

export default function Conferir() {
  const { perfil, sair } = useAuth();
  const [params, setParams] = useSearchParams();
  const { lista: remessas, escolhida, escolher, carregando: carregandoRemessas } = useRemessaEscolhida(true);
  const confId = Number(params.get("conf")) || null;

  const ehSupervisor = perfil?.papel === "supervisor";
  const lojas = useConsulta<ConferenciaLoja[]>(
    () => {
      let q = supabase
        .from("v_conferencia_lojas")
        .select("*")
        .eq("remessa_id", escolhida?.id ?? -1)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome");
      // Operador vê só as lojas que o supervisor atribuiu a ele para conferir
      if (!ehSupervisor) q = q.eq("conferente_id", perfil?.id ?? "");
      return q;
    },
    [escolhida?.id, ehSupervisor, perfil?.id],
    { tabelas: ["conferencias", "pedidos"], ativo: !!escolhida && !confId },
  );

  const [abrindo, setAbrindo] = useState<number | null>(null);

  async function abrir(l: ConferenciaLoja, nova = false) {
    if (l.status === "finalizada" && !nova) {
      setParams({ remessa: String(l.remessa_id), conf: String(l.conferencia_id) });
      return;
    }
    setAbrindo(l.pedido_id);
    const { data, error } = await supabase.rpc("iniciar_conferencia", { p_pedido: l.pedido_id });
    setAbrindo(null);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    setParams({ remessa: String(l.remessa_id), conf: String(data) });
  }

  const voltarPara = perfil?.papel === "supervisor" ? "/conferencia" : "/inicio";

  return (
    <div className="flex h-dvh flex-col bg-fundo">
      <header className="shrink-0 bg-navy text-white">
        <div className="flex h-14 items-center gap-3 px-3 sm:h-16 sm:px-6">
          {confId ? (
            <button
              type="button"
              onClick={() => setParams(escolhida ? { remessa: String(escolhida.id) } : {})}
              className="rounded-lg p-2 hover:bg-white/10"
              aria-label="Voltar para as lojas"
              title="Voltar para as lojas"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <Link to={voltarPara} className="rounded-lg p-2 hover:bg-white/10" aria-label="Voltar" title="Voltar">
              <ArrowLeft className="size-5" />
            </Link>
          )}
          <Logo simbolo className="h-7 shrink-0 sm:h-8" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Conferência</p>
            <p className="truncate text-xs text-white/65">
              {perfil?.nome}
              {escolhida && ` · Remessa ${escolhida.codigo}`}
            </p>
          </div>
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {confId ? (
        <TelaConferencia key={confId} conferenciaId={confId} aoNovaContagem={(l) => abrir(l, true)} />
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold sm:text-2xl">Conferir remessa</h1>
                <p className="text-sm text-suave">Escolha a loja e bipe de novo tudo o que está separado para ela.</p>
              </div>
              {remessas.length > 0 && (
                <Selecao
                  rotulo="Remessa"
                  className="w-full sm:w-72"
                  value={escolhida?.id ?? ""}
                  onChange={(e) => escolher(Number(e.target.value))}
                >
                  {remessas
                    .filter((r) => r.status !== "pendente")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.codigo} · {r.status === "ativa" ? "ativa" : "concluída"}
                      </option>
                    ))}
                </Selecao>
              )}
            </div>

            {carregandoRemessas || (lojas.carregando && !lojas.dados) ? (
              <Carregando />
            ) : escolhida && escolhida.status !== "pendente" && (lojas.dados ?? []).length === 0 ? (
              <div className="rounded-2xl bg-white ring-1 ring-borda">
                <Vazio icone={<ClipboardCheck className="size-8" />} titulo="Nenhuma loja para você conferir">
                  {ehSupervisor
                    ? "Esta remessa não tem lojas."
                    : "Quando o supervisor atribuir uma loja a você na Conferência, ela aparece aqui."}
                </Vazio>
              </div>
            ) : !escolhida || escolhida.status === "pendente" ? (
              <div className="rounded-2xl bg-white ring-1 ring-borda">
                <Vazio icone={<ClipboardCheck className="size-8" />} titulo="Nenhuma remessa para conferir">
                  A conferência fica disponível depois que a remessa é ativada.
                </Vazio>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(lojas.dados ?? []).map((l) => (
                  <li key={l.pedido_id}>
                    <button
                      type="button"
                      onClick={() => abrir(l)}
                      disabled={abrindo === l.pedido_id}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 transition-colors hover:ring-azul disabled:opacity-60",
                        l.status === "finalizada" && !l.divergencias ? "ring-ciano/60" : l.divergencias ? "ring-erro/40" : "ring-borda",
                      )}
                    >
                      <SeloLoja numero={l.loja_numero} nome={l.loja_nome} className="size-12 text-xl" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{l.loja_nome}</span>
                        <span className="tabular block text-xs text-suave">
                          Separado {fmtNum(l.qtd_separada)} un.
                          {l.status && ` · conferido ${fmtNum(l.qtd_conferida)}`}
                        </span>
                        <SituacaoLoja l={l} />
                        {ehSupervisor && (
                          <span className="block truncate text-xs text-suave">
                            Conferente: {l.conferente_nome ?? <span className="text-[#7a5200]">não atribuído</span>}
                          </span>
                        )}
                      </span>
                      {abrindo === l.pedido_id && <LoaderCircle className="size-5 animate-spin text-azul" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

function TelaConferencia({
  conferenciaId,
  aoNovaContagem,
}: {
  conferenciaId: number;
  aoNovaContagem: (l: ConferenciaLoja) => void;
}) {
  const [, setParams] = useSearchParams();
  const [loja, setLoja] = useState<ConferenciaLoja | null>(null);
  const [status, setStatus] = useState<StatusConferencia | null>(null);
  const [linhas, setLinhas] = useState<LinhaConfronto[] | null>(null);
  const [gtin, setGtin] = useState("");
  const [modoRapido, setModoRapido] = useModoRapido("wms.conferenciaRapida");
  // Produto bipado esperando a quantidade (como na separação)
  const [pendente, setPendente] = useState<{ gtin: string; linha: LinhaConfronto | null } | null>(null);
  const [qtd, setQtd] = useState("1");
  const campoQtd = useRef<HTMLInputElement>(null);
  const [gravando, setGravando] = useState(false);
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [confrontar, setConfrontar] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);
  const seq = useRef(0);

  async function carregar() {
    const { data: c } = await supabase.from("conferencias").select("pedido_id,status").eq("id", conferenciaId).single();
    if (!c) return;
    setStatus(c.status as StatusConferencia);
    const [{ data: l }, { data: r }] = await Promise.all([
      supabase.from("v_conferencia_lojas").select("*").eq("pedido_id", c.pedido_id).single(),
      supabase.rpc("resumo_conferencia", { p_conferencia: conferenciaId }),
    ]);
    setLoja(l as ConferenciaLoja);
    setLinhas((r ?? []) as LinhaConfronto[]);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenciaId]);

  const focar = () => requestAnimationFrame(() => campo.current?.focus());
  useEffect(() => {
    if (status === "em_andamento") focar();
  }, [status]);

  const totais = useMemo(() => {
    const l = linhas ?? [];
    const separado = l.reduce((s, x) => s + x.qtd_separada, 0);
    const conferido = l.filter((x) => x.situacao !== "fora_do_pedido").reduce((s, x) => s + Math.min(x.qtd_conferida, x.qtd_separada), 0);
    return { separado, conferido, situacoes: contarSituacoes(l) };
  }, [linhas]);

  async function bipar(codigo: string, qtd: number): Promise<boolean> {
    const c = codigo.replace(/\s/g, "");
    if (!c || ocupado.current || status !== "em_andamento") return false;
    ocupado.current = true;
    setGravando(true);
    setGtin("");
    const { data, error } = await supabase.rpc("bipar_conferencia", { p_conferencia: conferenciaId, p_gtin: c, p_qtd: qtd });
    setGravando(false);
    ocupado.current = false;
    focar();
    if (error) {
      somErro();
      vibrar([80, 60, 80]);
      toast.error(mensagemErro(error));
      return false;
    }
    const linha = (data as LinhaConfronto[])[0];
    setLinhas((ls) => {
      const outras = (ls ?? []).filter((x) => x.gtin !== linha.gtin);
      return [linha, ...outras];
    });
    setLeituras((ls) => [{ id: ++seq.current, gtin: linha.gtin, produto: linha.produto, qtd, linha, hora: new Date() }, ...ls].slice(0, 10));
    if (linha.situacao === "fora_do_pedido") {
      somErro();
      vibrar([200, 80, 200]);
    } else if (linha.situacao === "sobra") {
      somAviso();
      vibrar([80, 60, 80]);
    } else {
      somOk();
      vibrar(40);
    }
    return true;
  }

  /** Bipou: no modo rápido conta 1; senão mostra o produto e pede a quantidade. */
  function lido(codigo: string) {
    const c = codigo.replace(/\s/g, "");
    if (!c || status !== "em_andamento") return;
    if (modoRapido) {
      void bipar(c, 1);
      return;
    }
    setGtin("");
    setPendente({ gtin: c, linha: (linhas ?? []).find((l) => l.gtin === c) ?? null });
    setQtd("1");
    requestAnimationFrame(() => {
      campoQtd.current?.focus();
      campoQtd.current?.select();
    });
  }

  async function confirmarQtd() {
    if (!pendente || gravando) return;
    leitorQtd.cancelar();
    // Bipou outro produto com o campo de quantidade em foco: troca de produto
    if (/^\d{8,}$/.test(qtd.trim())) {
      lido(qtd.trim());
      return;
    }
    if (!qtdValida(qtd)) {
      somErro();
      toast.error("Quantidade deve ser de 1 a 9999");
      return;
    }
    const ok = await bipar(pendente.gtin, Number(qtd));
    if (ok) {
      setPendente(null);
      focar();
    }
  }

  function cancelarQtd() {
    setPendente(null);
    focar();
  }

  const leitor = useLeitor(lido);
  const leitorQtd = useLeitor(lido);

  async function desfazer(l: Leitura) {
    await bipar(l.gtin, -l.qtd);
    setLeituras((ls) => ls.filter((x) => x.id !== l.id));
  }

  async function finalizar() {
    setFinalizando(true);
    const { error } = await supabase.rpc("finalizar_conferencia", { p_conferencia: conferenciaId });
    setFinalizando(false);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    setConfrontar(false);
    toast.success("Conferência finalizada");
    carregar();
  }

  if (!linhas || !loja || !status) return <Carregando />;

  const ultima = leituras[0];
  const finalizada = status === "finalizada";

  return (
    <>
      {/* Loja que está sendo conferida */}
      <div className="flex shrink-0 items-center gap-3 border-b border-borda bg-white px-3 py-2.5 sm:px-6">
        <SeloLoja numero={loja.loja_numero} nome={loja.loja_nome} className="size-11 text-lg sm:size-12 sm:text-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-semibold sm:text-xl">{loja.loja_nome}</p>
          <p className="tabular text-xs text-suave">
            Pedido {loja.pedido_nome} · conferido {fmtNum(totais.conferido)} de {fmtNum(totais.separado)} un. ·{" "}
            {fmtPct(totais.conferido, totais.separado)}
          </p>
          <Barra parte={totais.conferido} total={totais.separado} className="mt-1 h-1.5" />
        </div>
        {finalizada ? (
          <Botao variante="secundario" icone={<RotateCcw className="size-4" />} onClick={() => aoNovaContagem(loja)}>
            <span className="hidden sm:inline">Conferir de novo</span>
          </Botao>
        ) : (
          <Botao variante="sucesso" icone={<CheckCheck className="size-4" />} onClick={() => setConfrontar(true)}>
            Finalizar
          </Botao>
        )}
      </div>

      {finalizada ? (
        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto max-w-4xl space-y-4 rounded-2xl bg-white p-4 ring-1 ring-borda sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Resultado da conferência</h2>
              <span className="text-sm text-suave">
                Finalizada {tempoRelativo(loja.finalizada_em)}
                {loja.finalizada_por_nome && ` por ${loja.finalizada_por_nome}`}
              </span>
            </div>
            <Confronto linhas={linhas} />
            <Botao variante="secundario" onClick={() => setParams({ remessa: String(loja.remessa_id) })}>
              Voltar para as lojas
            </Botao>
          </div>
        </main>
      ) : (
        <>
          <div className="shrink-0 border-b border-borda bg-white px-3 pb-2.5 sm:px-6">
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                leitor.cancelar();
                lido(gtin);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative min-w-0 flex-1">
                {gravando ? (
                  <LoaderCircle className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 animate-spin text-azul" aria-hidden />
                ) : (
                  <ScanBarcode className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-azul" aria-hidden />
                )}
                <label htmlFor="campo-conferencia" className="sr-only">
                  Bipe o produto para conferir
                </label>
                <input
                  id="campo-conferencia"
                  ref={campo}
                  value={gtin}
                  onChange={(e) => {
                    leitor.digitou(e.target.value, gtin);
                    setGtin(e.target.value);
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  placeholder="Bipe o produto"
                  className="tabular h-14 w-full rounded-xl border-2 border-azul/30 bg-azul-claro/40 pr-3 pl-13 text-lg font-medium tracking-wide placeholder:font-normal placeholder:tracking-normal placeholder:text-suave/80 focus:border-azul focus:bg-white focus:outline-none sm:text-xl"
                />
              </div>
              <ChaveModoRapido
                ligado={modoRapido}
                aoMudar={(v) => {
                  setModoRapido(v);
                  cancelarQtd();
                }}
              />
            </form>
          </div>

          <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-5">
            {/* Resultado do último bip */}
            <div className="flex flex-[1_0_auto] flex-col">
              {pendente && !modoRapido ? (
                <QuantidadeLeitura
                  aviso={pendente.linha ? "Quantas unidades estão na caixa?" : "Este produto não é desta loja"}
                  tom={pendente.linha ? "normal" : "erro"}
                  produto={pendente.linha?.produto ?? "Produto fora do pedido desta loja"}
                  gtin={pendente.gtin}
                  numeros={
                    pendente.linha
                      ? [
                          { rotulo: "Separado", valor: pendente.linha.qtd_separada },
                          { rotulo: "Conferido", valor: pendente.linha.qtd_conferida },
                        ]
                      : []
                  }
                  qtd={qtd}
                  setQtd={setQtd}
                  falta={pendente.linha ? pendente.linha.qtd_separada - pendente.linha.qtd_conferida : 0}
                  campoRef={campoQtd}
                  aoDigitar={leitorQtd.digitou}
                  gravando={gravando}
                  aoConfirmar={confirmarQtd}
                  aoCancelar={cancelarQtd}
                />
              ) : ultima ? (
                <div
                  className={cx(
                    "flex flex-1 flex-col items-center justify-center gap-2 rounded-3xl px-4 py-[clamp(0.75rem,3vh,2rem)] text-center",
                    ultima.linha.situacao === "fora_do_pedido"
                      ? "bg-erro text-white"
                      : ultima.linha.situacao === "sobra"
                        ? "bg-amarelo text-navy"
                        : ultima.linha.qtd_conferida === ultima.linha.qtd_separada
                          ? "bg-ciano text-navy"
                          : "bg-navy text-white",
                  )}
                  aria-live="assertive"
                >
                  <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80 sm:text-base">
                    {ultima.linha.situacao === "fora_do_pedido"
                      ? "Este produto não é desta loja"
                      : ultima.linha.situacao === "sobra"
                        ? "Sobrando: mais do que foi separado"
                        : ultima.linha.qtd_conferida === ultima.linha.qtd_separada
                          ? "Produto completo"
                          : "Conferindo"}
                  </p>
                  <p className="line-clamp-2 max-w-3xl text-[length:clamp(1.25rem,min(4vh,6vw),2.5rem)] leading-tight font-semibold">
                    {ultima.produto}
                  </p>
                  <p className="tabular text-[length:clamp(2.5rem,min(10vh,16vw),6rem)] leading-none font-semibold">
                    {ultima.linha.qtd_conferida}
                    <span className="text-[0.45em] opacity-70"> / {ultima.linha.qtd_separada}</span>
                  </p>
                  <p className="text-sm opacity-80">conferido / separado{ultima.linha.qtd_pedido ? ` · pedido ${ultima.linha.qtd_pedido}` : ""}</p>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-white px-4 py-6 text-center ring-1 ring-borda">
                  <span className="grid size-20 place-items-center rounded-full bg-azul-claro text-azul">
                    <ScanBarcode className="size-10" aria-hidden />
                  </span>
                  <p className="text-2xl font-semibold">Bipe os produtos da caixa</p>
                  <p className="max-w-md text-sm text-suave">
                    Bipe o produto, digite a quantidade e confirme (no <strong>Modo rápido</strong>, cada bip já conta 1). No fim, toque em{" "}
                    <strong>Finalizar</strong> para ver o confronto com a separação.
                  </p>
                </div>
              )}
            </div>

            {/* Últimas leituras */}
            <section
              className="flex min-h-28 flex-[0_1_10rem] flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-borda sm:flex-[0_1_13rem]"
              aria-label="Últimas leituras"
            >
              <h2 className="flex shrink-0 items-center gap-2 border-b border-borda px-4 py-2 text-sm font-semibold">
                <History className="size-4 text-azul" aria-hidden /> Últimas leituras
              </h2>
              {leituras.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-sm text-suave">As leituras aparecem aqui.</p>
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-borda overflow-y-auto">
                  {leituras.map((l, i) => (
                    <li key={l.id} className={cx("flex items-center gap-3 px-4 py-1.5 text-sm", i === 0 && "bg-azul-claro/40")}>
                      <time className="tabular w-16 shrink-0 text-xs text-suave">
                        {l.hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </time>
                      <span className="tabular w-10 shrink-0 text-center text-xs font-semibold">
                        {l.qtd > 0 ? "+" : ""}
                        {l.qtd}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.produto}</span>
                      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", ROTULO_SITUACAO[l.linha.situacao].classe)}>
                        {l.linha.qtd_conferida}/{l.linha.qtd_separada}
                      </span>
                      {l.qtd > 0 && (
                        <button
                          type="button"
                          onClick={() => desfazer(l)}
                          className="shrink-0 rounded-lg p-1.5 text-suave hover:bg-fundo hover:text-navy"
                          aria-label={`Desfazer leitura de ${l.produto}`}
                          title="Desfazer"
                        >
                          <Undo2 className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>
        </>
      )}

      <Modal aberto={confrontar} aoFechar={() => { setConfrontar(false); focar(); }} titulo={`Confronto · ${loja.loja_nome}`} largura="max-w-3xl">
        <Confronto linhas={linhas} />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Botao variante="secundario" onClick={() => { setConfrontar(false); focar(); }}>
            Continuar bipando
          </Botao>
          <Botao variante="sucesso" icone={<CheckCheck className="size-4" />} carregando={finalizando} onClick={finalizar}>
            Finalizar conferência
          </Botao>
        </div>
      </Modal>
    </>
  );
}
