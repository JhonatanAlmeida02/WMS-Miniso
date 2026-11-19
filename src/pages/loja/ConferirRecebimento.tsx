import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, History, LoaderCircle, LogOut, ScanBarcode, ShieldAlert, Undo2, WifiOff } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { mensagemErro, supabase } from "../../lib/supabase";
import { useLeitor } from "../../lib/useLeitor";
import { novaOperacao, rpcSegura, useConexao } from "../../lib/operacao";
import { fmtNum, fmtPct, nomeLoja, tempoRelativo } from "../../lib/formato";
import { somAviso, somErro, somOk, vibrar } from "../../lib/som";
import type { Expedicao, LinhaRecebimento, StatusRecebimento } from "../../lib/tipos";
import { Logo } from "../../components/Logo";
import { Barra, Botao, Carregando, Modal, Vazio, cx } from "../../components/ui";
import { ConfrontoRecebimento, ROTULO_SITUACAO_RECEBIMENTO, SeloRecebimento } from "../../components/loja/comum";
import { ChaveModoRapido, QuantidadeLeitura, qtdValida, useModoRapido } from "../../components/QuantidadeLeitura";

interface Leitura {
  bipId: number;
  gtin: string;
  produto: string;
  qtd: number;
  avariado: boolean;
  linha: LinhaRecebimento;
  hora: Date;
}

type RespostaBip = (LinhaRecebimento & { bip_id: number })[];

/**
 * Conferência de recebimento na loja. Mesmo layout, campo de leitura, sons e
 * comportamento de coletor da conferência do CD (Conferir.tsx). Muda só a
 * fonte: o esperado é o manifesto da entrega e as leituras vão para as
 * tabelas do recebimento.
 */
export default function ConferirRecebimento() {
  const { recebimento } = useParams();
  const recebimentoId = Number(recebimento);
  const { perfil, sair } = useAuth();
  const online = useConexao();

  const [entrega, setEntrega] = useState<Expedicao | null>(null);
  const [status, setStatus] = useState<StatusRecebimento | null>(null);
  const [linhas, setLinhas] = useState<LinhaRecebimento[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [gtin, setGtin] = useState("");
  const [modoRapido, setModoRapido] = useModoRapido("wms.recebimentoRapido");
  // Produto bipado esperando a quantidade (como na separação)
  const [pendente, setPendente] = useState<{ gtin: string; linha: LinhaRecebimento | null } | null>(null);
  const [qtd, setQtd] = useState("1");
  const campoQtd = useRef<HTMLInputElement>(null);
  const [avaria, setAvaria] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [leituras, setLeituras] = useState<Leitura[]>([]);
  const [confrontar, setConfrontar] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);

  async function carregar() {
    const { data: e, error } = await supabase.from("v_expedicoes").select("*").eq("recebimento_id", recebimentoId).maybeSingle();
    if (error || !e) {
      setErroCarga(error ? mensagemErro(error) : "Entrega não encontrada para a sua loja.");
      return;
    }
    let st = (e as Expedicao).recebimento_status;
    // Abrir a entrega é iniciar a conferência (como no CD)
    if (st === "aguardando") {
      const { data, error: err } = await supabase.rpc("iniciar_recebimento_loja", { p_recebimento: recebimentoId });
      if (err) {
        setErroCarga(mensagemErro(err));
        return;
      }
      st = data as StatusRecebimento;
    }
    const { data: r } = await supabase.rpc("resumo_recebimento", { p_recebimento: recebimentoId });
    setEntrega(e as Expedicao);
    setStatus(st);
    setLinhas((r ?? []) as LinhaRecebimento[]);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recebimentoId]);

  const focar = () => requestAnimationFrame(() => campo.current?.focus());
  useEffect(() => {
    if (status === "em_conferencia") focar();
  }, [status]);

  const totais = useMemo(() => {
    const l = linhas ?? [];
    const expedido = l.reduce((s, x) => s + x.qtd_expedida, 0);
    const recebido = l.filter((x) => x.situacao !== "inesperado").reduce((s, x) => s + Math.min(x.qtd_recebida, x.qtd_expedida), 0);
    return { expedido, recebido };
  }, [linhas]);

  function aplicar(linha: LinhaRecebimento) {
    setLinhas((ls) => [linha, ...(ls ?? []).filter((x) => x.gtin !== linha.gtin)]);
  }

  async function bipar(codigo: string, qtd: number): Promise<boolean> {
    const c = codigo.replace(/\s/g, "");
    if (!c || ocupado.current || status !== "em_conferencia") return false;
    if (!online) {
      somErro();
      toast.error("Sem internet: a leitura não foi gravada. Bipe de novo quando a conexão voltar.");
      return false;
    }
    ocupado.current = true;
    setGravando(true);
    setGtin("");
    const avariado = avaria;
    // Um identificador por leitura física; os retries reusam o mesmo
    const { data, error } = await rpcSegura<RespostaBip>("bipar_recebimento", {
      p_recebimento: recebimentoId,
      p_gtin: c,
      p_qtd: qtd,
      p_avariado: avariado,
      p_operacao: novaOperacao(),
    });
    setGravando(false);
    ocupado.current = false;
    focar();
    if (error || !data?.[0]) {
      somErro();
      vibrar([80, 60, 80]);
      toast.error(error ? mensagemErro(error) : "Leitura não confirmada. Bipe de novo.");
      return false;
    }
    const { bip_id, ...linha } = data[0];
    aplicar(linha);
    setAvaria(false); // avaria vale para a leitura marcada
    setLeituras((ls) => [{ bipId: bip_id, gtin: linha.gtin, produto: linha.produto, qtd, avariado, linha, hora: new Date() }, ...ls].slice(0, 10));
    if (linha.situacao === "inesperado") {
      somErro();
      vibrar([200, 80, 200]);
    } else if (linha.situacao === "sobra" || avariado) {
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
    if (!c || status !== "em_conferencia") return;
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
    if (ocupado.current) return;
    ocupado.current = true;
    const { data, error } = await rpcSegura<RespostaBip>("estornar_bip_recebimento", { p_bip: l.bipId, p_operacao: novaOperacao() });
    ocupado.current = false;
    focar();
    if (error || !data?.[0]) {
      somErro();
      toast.error(error ? mensagemErro(error) : "Não foi possível desfazer");
      return;
    }
    const { bip_id: _ignorar, ...linha } = data[0];
    void _ignorar;
    aplicar(linha);
    setLeituras((ls) => ls.filter((x) => x.bipId !== l.bipId));
  }

  async function finalizar() {
    setFinalizando(true);
    const { data, error } = await rpcSegura<StatusRecebimento>("finalizar_recebimento_loja", { p_recebimento: recebimentoId });
    setFinalizando(false);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    setConfrontar(false);
    toast.success(data === "recebido_conferido" ? "Recebimento conferido: tudo bate" : "Recebimento finalizado com divergência. A PRODIGY foi avisada.");
    carregar();
  }

  const finalizada = status === "recebido_conferido" || status === "recebido_com_divergencia";
  const ultima = leituras[0];

  return (
    <div className="flex h-dvh flex-col bg-fundo">
      <header className="shrink-0 bg-navy text-white">
        <div className="flex h-14 items-center gap-3 px-3 sm:h-16 sm:px-6">
          <Link to="/loja/entregas" className="rounded-lg p-2 hover:bg-white/10" aria-label="Voltar para as entregas" title="Voltar">
            <ArrowLeft className="size-5" />
          </Link>
          <Logo simbolo className="h-7 shrink-0 sm:h-8" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Conferência de recebimento</p>
            <p className="truncate text-xs text-white/65">
              {entrega ? `Loja ${nomeLoja(entrega.loja_nome, entrega.loja_numero)} · ` : ""}
              {perfil?.nome}
              {entrega && ` · Remessa ${entrega.remessa_codigo}`}
            </p>
          </div>
          {!online && (
            <span className="inline-flex items-center gap-1 rounded-full bg-erro px-2 py-1 text-xs font-semibold">
              <WifiOff className="size-3.5" /> Sem internet
            </span>
          )}
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {erroCarga ? (
        <main className="flex-1 p-3 sm:p-6">
          <div className="mx-auto max-w-lg rounded-2xl bg-white ring-1 ring-borda">
            <Vazio icone={<ShieldAlert className="size-8" />} titulo="Não foi possível abrir a entrega">
              {erroCarga}
            </Vazio>
          </div>
        </main>
      ) : !linhas || !entrega || !status ? (
        <Carregando />
      ) : (
        <>
          {/* Entrega que está sendo conferida */}
          <div className="flex shrink-0 items-center gap-3 border-b border-borda bg-white px-3 py-2.5 sm:px-6">
            <span className="tabular grid size-11 shrink-0 place-items-center rounded-[28%] bg-ciano text-lg font-semibold text-navy sm:size-12 sm:text-xl" aria-hidden>
              {entrega.numero}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg leading-tight font-semibold sm:text-xl">
                Pedido {entrega.pedido_nome} · entrega {entrega.numero}
              </p>
              <p className="tabular text-xs text-suave">
                {entrega.volumes} vol. · recebido {fmtNum(totais.recebido)} de {fmtNum(totais.expedido)} un. · {fmtPct(totais.recebido, totais.expedido)}
              </p>
              <Barra parte={totais.recebido} total={totais.expedido} className="mt-1 h-1.5" />
            </div>
            {finalizada ? (
              <SeloRecebimento status={status} />
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
                  <h2 className="text-lg font-semibold">Resultado do recebimento</h2>
                  <span className="text-sm text-suave">
                    Finalizado {tempoRelativo(entrega.finalizado_em)}
                    {entrega.finalizado_por_nome && ` por ${entrega.finalizado_por_nome}`}
                  </span>
                </div>
                <ConfrontoRecebimento linhas={linhas} />
                <p className="text-sm text-suave">Para contar de novo, peça à PRODIGY para reabrir este recebimento.</p>
                <Link to="/loja/entregas" className="inline-flex font-medium text-azul-escuro hover:underline">
                  Voltar para as entregas
                </Link>
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
                    <label htmlFor="campo-recebimento" className="sr-only">
                      Bipe o produto para conferir
                    </label>
                    <input
                      id="campo-recebimento"
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
                      placeholder={avaria ? "Bipe o produto avariado" : "Bipe o produto"}
                      disabled={!online}
                      className={cx(
                        "tabular h-14 w-full rounded-xl border-2 pr-3 pl-13 text-lg font-medium tracking-wide placeholder:font-normal placeholder:tracking-normal placeholder:text-suave/80 focus:bg-white focus:outline-none disabled:opacity-60 sm:text-xl",
                        avaria ? "border-amarelo bg-amarelo-claro focus:border-amarelo" : "border-azul/30 bg-azul-claro/40 focus:border-azul",
                      )}
                    />
                  </div>
                  <ChaveModoRapido
                    ligado={modoRapido}
                    aoMudar={(v) => {
                      setModoRapido(v);
                      cancelarQtd();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAvaria((a) => !a);
                      if (pendente) requestAnimationFrame(() => campoQtd.current?.focus());
                      else focar();
                    }}
                    aria-pressed={avaria}
                    aria-label="Avaria: a próxima leitura conta como avariada"
                    title="A próxima leitura conta como avariada"
                    className={cx(
                      "flex h-14 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold",
                      avaria ? "border-amarelo bg-amarelo text-navy" : "border-borda text-suave hover:bg-fundo",
                    )}
                  >
                    <ShieldAlert className="size-5" aria-hidden />
                    <span className="hidden sm:inline">Avaria</span>
                  </button>
                </form>
              </div>

              <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-5">
                {/* Resultado do último bip */}
                <div className="flex flex-[1_0_auto] flex-col">
                  {pendente && !modoRapido ? (
                    <QuantidadeLeitura
                      aviso={
                        !pendente.linha
                          ? "Este produto não veio nesta entrega"
                          : avaria
                            ? "Avaria: quantas unidades danificadas?"
                            : "Quantas unidades chegaram?"
                      }
                      tom={!pendente.linha ? "erro" : avaria ? "aviso" : "normal"}
                      produto={pendente.linha?.produto ?? "Produto não esperado nesta entrega"}
                      gtin={pendente.gtin}
                      numeros={
                        pendente.linha
                          ? [
                              { rotulo: "Expedido", valor: pendente.linha.qtd_expedida },
                              { rotulo: "Recebido", valor: pendente.linha.qtd_recebida },
                              { rotulo: "Falta", valor: Math.max(0, pendente.linha.qtd_expedida - pendente.linha.qtd_recebida) },
                            ]
                          : []
                      }
                      qtd={qtd}
                      setQtd={setQtd}
                      falta={pendente.linha ? pendente.linha.qtd_expedida - pendente.linha.qtd_recebida : 0}
                      campoRef={campoQtd}
                      aoDigitar={leitorQtd.digitou}
                      gravando={gravando}
                      aoConfirmar={confirmarQtd}
                      aoCancelar={cancelarQtd}
                      textoConfirmar={avaria ? "Confirmar avaria" : "Confirmar"}
                    />
                  ) : ultima ? (
                    <div
                      className={cx(
                        "flex flex-1 flex-col items-center justify-center gap-2 rounded-3xl px-4 py-[clamp(0.75rem,3vh,2rem)] text-center",
                        ultima.linha.situacao === "inesperado"
                          ? "bg-erro text-white"
                          : ultima.linha.situacao === "sobra" || ultima.avariado
                            ? "bg-amarelo text-navy"
                            : ultima.linha.qtd_recebida === ultima.linha.qtd_expedida
                              ? "bg-ciano text-navy"
                              : "bg-navy text-white",
                      )}
                      aria-live="assertive"
                    >
                      <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80 sm:text-base">
                        {ultima.linha.situacao === "inesperado"
                          ? "Este produto não veio nesta entrega"
                          : ultima.avariado
                            ? "Avaria registrada"
                            : ultima.linha.situacao === "sobra"
                              ? "Sobrando: mais do que foi expedido"
                              : ultima.linha.qtd_recebida === ultima.linha.qtd_expedida
                                ? "Produto completo"
                                : "Conferindo"}
                      </p>
                      <p className="line-clamp-2 max-w-3xl text-[length:clamp(1.25rem,min(4vh,6vw),2.5rem)] leading-tight font-semibold">{ultima.produto}</p>
                      <p className="tabular text-[length:clamp(2.5rem,min(10vh,16vw),6rem)] leading-none font-semibold">
                        {ultima.linha.qtd_recebida}
                        <span className="text-[0.45em] opacity-70"> / {ultima.linha.qtd_expedida}</span>
                      </p>
                      <p className="text-sm opacity-80">
                        recebido / expedido{ultima.linha.qtd_pedido ? ` · pedido ${ultima.linha.qtd_pedido}` : ""}
                        {ultima.linha.qtd_avariada > 0 && ` · ${ultima.linha.qtd_avariada} avariado${ultima.linha.qtd_avariada > 1 ? "s" : ""}`}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-white px-4 py-6 text-center ring-1 ring-borda">
                      <span className="grid size-20 place-items-center rounded-full bg-azul-claro text-azul">
                        <ScanBarcode className="size-10" aria-hidden />
                      </span>
                      <p className="text-2xl font-semibold">Bipe os produtos que chegaram</p>
                      <p className="max-w-md text-sm text-suave">
                        Bipe o produto, digite a quantidade e confirme (no <strong>Modo rápido</strong>, cada bip já conta 1). Produto danificado:
                        toque em <strong>Avaria</strong>. No fim, toque em <strong>Finalizar</strong> para ver o confronto com o que saiu do CD.
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
                        <li key={l.bipId} className={cx("flex items-center gap-3 px-4 py-1.5 text-sm", i === 0 && "bg-azul-claro/40")}>
                          <time className="tabular w-16 shrink-0 text-xs text-suave">
                            {l.hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </time>
                          <span className="tabular w-10 shrink-0 text-center text-xs font-semibold">+{l.qtd}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {l.avariado && <ShieldAlert className="mr-1 inline size-3.5 text-[#7a5200]" aria-label="avariado" />}
                            {l.produto}
                          </span>
                          <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", ROTULO_SITUACAO_RECEBIMENTO[l.linha.situacao].classe)}>
                            {l.linha.qtd_recebida}/{l.linha.qtd_expedida}
                          </span>
                          <button
                            type="button"
                            onClick={() => desfazer(l)}
                            className="shrink-0 rounded-lg p-1.5 text-suave hover:bg-fundo hover:text-navy"
                            aria-label={`Desfazer leitura de ${l.produto}`}
                            title="Desfazer"
                          >
                            <Undo2 className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </main>
            </>
          )}

          <Modal
            aberto={confrontar}
            aoFechar={() => {
              setConfrontar(false);
              focar();
            }}
            titulo={`Confronto · entrega ${entrega.numero}`}
            largura="max-w-3xl"
          >
            <ConfrontoRecebimento linhas={linhas} />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Botao
                variante="secundario"
                onClick={() => {
                  setConfrontar(false);
                  focar();
                }}
              >
                Continuar bipando
              </Botao>
              <Botao variante="sucesso" icone={<CheckCheck className="size-4" />} carregando={finalizando} onClick={finalizar} disabled={!online}>
                Finalizar conferência
              </Botao>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
