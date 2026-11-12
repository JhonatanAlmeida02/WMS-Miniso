import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Check, History, ListChecks, LoaderCircle, LogOut, Minus, Plus, ScanBarcode, Undo2, X, Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum, fmtPct, nomeLoja } from "../lib/formato";
import { somAviso, somErro, somOk, vibrar } from "../lib/som";
import type { Bip, ItemDoGtin, PedidoResumo, TipoBip } from "../lib/tipos";
import { Logo } from "../components/Logo";
import { Barra, Carregando, Modal, Vazio, cx } from "../components/ui";

const CHAVE_MODO_RAPIDO = "wms.modoRapido";
const QTD_ULTIMOS_BIPS = 10;

function lerModoRapido() {
  try {
    return localStorage.getItem(CHAVE_MODO_RAPIDO) === "1";
  } catch {
    return false;
  }
}

/**
 * Reconhece a leitura de um leitor de código de barras: ele "digita" o código
 * inteiro em poucos milissegundos. Assim a busca sai sozinha, mesmo que o
 * leitor não mande Enter; quem digita à mão confirma com Enter.
 */
function useLeitor(aoLer: (codigo: string) => void) {
  const inicio = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    /** Chame no onChange com o valor novo. */
    digitou(valor: string, anterior: string) {
      const agora = performance.now();
      if (!anterior || valor.length < anterior.length) inicio.current = agora;
      clearTimeout(timer.current);
      const limpo = valor.replace(/\s/g, "");
      if (limpo.length >= 8 && /^[0-9A-Za-z-]+$/.test(limpo)) {
        const porTecla = (agora - inicio.current) / Math.max(1, limpo.length - 1);
        if (porTecla < 35) timer.current = setTimeout(() => aoLerRef.current(limpo), 90);
      }
    },
    /** Chame no Enter, para não buscar duas vezes. */
    cancelar() {
      clearTimeout(timer.current);
    },
  };
}

interface Ultimo {
  itemId: number;
  pedidoId: number;
  produto: string;
  lojaNome: string;
  lojaNumero: number | null;
  qtd: number;
  tipo: TipoBip;
  separado: number;
  pedido: number;
}

/** Número da loja em destaque (ou as iniciais, se a loja não tiver número). */
function SeloLoja({ numero, nome, className }: { numero: number | null; nome: string; className?: string }) {
  const texto =
    numero != null
      ? String(numero).padStart(2, "0")
      : nome
          .replace(/^loja\s+/i, "")
          .split(/\s+/)
          .slice(0, 2)
          .map((p) => p[0]?.toUpperCase())
          .join("");
  return (
    <span className={cx("tabular grid shrink-0 place-items-center rounded-[28%] bg-ciano font-semibold text-navy", className)} aria-hidden>
      {texto}
    </span>
  );
}

/** Caixinha de número (Pedido / Separado / Falta) sobre fundo escuro. */
function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={cx("min-w-0 flex-1 rounded-2xl px-3 py-2 text-center sm:py-3", destaque ? "bg-amarelo text-navy" : "bg-white/10")}>
      <p className={cx("text-xs font-medium tracking-wide uppercase sm:text-sm", destaque ? "text-navy/70" : "text-white/60")}>{rotulo}</p>
      <p className="tabular text-3xl leading-tight font-semibold sm:text-5xl">{fmtNum(valor)}</p>
    </div>
  );
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Separacao() {
  const { perfil, sair } = useAuth();
  const [gtin, setGtin] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [item, setItem] = useState<ItemDoGtin | null>(null);
  const [itensGtin, setItensGtin] = useState<ItemDoGtin[]>([]);
  const [qtd, setQtd] = useState("1");
  const [tipo, setTipo] = useState<TipoBip>("entrada");
  const [gravando, setGravando] = useState(false);
  const [modoRapido, setModoRapido] = useState(lerModoRapido);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [verPedidos, setVerPedidos] = useState(false);
  const campoGtin = useRef<HTMLInputElement>(null);
  const campoQtd = useRef<HTMLInputElement>(null);
  const ocupado = useRef(false);

  const pedidos = useConsulta<PedidoResumo[]>(
    () =>
      supabase
        .from("v_pedidos")
        .select("*")
        .eq("operador_id", perfil!.id)
        .eq("remessa_status", "ativa")
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome")
        .order("nome"),
    [perfil?.id],
    { tabelas: ["itens_pedido", "pedidos", "remessas"] },
  );

  const bips = useConsulta<Bip[]>(
    () =>
      supabase
        .from("v_bips")
        .select("*")
        .eq("operador_id", perfil!.id)
        .order("criado_em", { ascending: false })
        .limit(QTD_ULTIMOS_BIPS),
    [perfil?.id],
    { tabelas: ["bips"] },
  );

  const lista = pedidos.dados ?? [];
  const pedidoDe = (id: number | undefined) => lista.find((p) => p.id === id);

  const falta = item ? item.qtd_pedido - item.qtd_separada : 0;
  const qtdNum = Number(qtd);
  const qtdValida =
    !!item &&
    qtd.trim() !== "" &&
    Number.isInteger(qtdNum) &&
    qtdNum !== 0 &&
    (tipo === "entrada" ? qtdNum > 0 && qtdNum <= falta : qtdNum >= -item.qtd_separada && qtdNum <= falta);

  // Este produto nas outras lojas do operador (sem contar a loja atual)
  const outrasLojas = item ? itensGtin.filter((i) => i.item_id !== item.item_id && i.qtd_separada < i.qtd_pedido) : [];
  const faltaOutras = outrasLojas.reduce((s, i) => s + i.qtd_pedido - i.qtd_separada, 0);

  function focarBip() {
    requestAnimationFrame(() => campoGtin.current?.focus());
  }

  function limpar() {
    setItem(null);
    setQtd("1");
    setTipo("entrada");
    setGtin("");
    focarBip();
  }

  useEffect(() => {
    focarBip();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_MODO_RAPIDO, modoRapido ? "1" : "0");
    } catch {
      /* sem armazenamento */
    }
  }, [modoRapido]);

  async function registrar(alvo: ItemDoGtin, quantidade: number, tipoBip: TipoBip) {
    setGravando(true);
    const { data, error } = await supabase.rpc("registrar_bip", {
      p_item_id: alvo.item_id,
      p_qtd: quantidade,
      p_tipo: tipoBip,
    });
    setGravando(false);
    if (error) {
      somErro();
      vibrar([80, 60, 80]);
      toast.error(mensagemErro(error));
      return false;
    }
    somOk();
    vibrar(40);
    const novo = (data as { qtd_separada: number }[])[0]?.qtd_separada ?? alvo.qtd_separada + quantidade;
    setItensGtin((l) => l.map((i) => (i.item_id === alvo.item_id ? { ...i, qtd_separada: novo } : i)));
    setUltimo({
      itemId: alvo.item_id,
      pedidoId: alvo.pedido_id,
      produto: alvo.produto,
      lojaNome: alvo.loja_nome,
      lojaNumero: alvo.loja_numero,
      qtd: quantidade,
      tipo: tipoBip,
      separado: novo,
      pedido: alvo.qtd_pedido,
    });
    pedidos.recarregar();
    bips.recarregar();
    return true;
  }

  async function desfazerUltimo() {
    if (!ultimo || gravando) return;
    setGravando(true);
    const { error } = await supabase.rpc("registrar_bip", {
      p_item_id: ultimo.itemId,
      p_qtd: -ultimo.qtd,
      p_tipo: "ajuste",
    });
    setGravando(false);
    if (error) {
      somErro();
      toast.error(mensagemErro(error));
      return;
    }
    somAviso();
    toast.success(`Desfeito: ${-ultimo.qtd > 0 ? "+" : ""}${-ultimo.qtd} em ${nomeLoja(ultimo.lojaNome, ultimo.lojaNumero)}`);
    setUltimo(null);
    pedidos.recarregar();
    bips.recarregar();
    focarBip();
  }

  async function buscar(codigo: string) {
    const c = codigo.replace(/\s/g, "");
    if (!c || ocupado.current) return;
    ocupado.current = true;
    setBuscando(true);
    setGtin("");
    const { data, error } = await supabase.rpc("itens_do_gtin", { p_gtin: c });
    setBuscando(false);
    try {
      if (error) {
        somErro();
        toast.error(mensagemErro(error));
        focarBip();
        return;
      }
      const lista = (data ?? []) as ItemDoGtin[];
      setItensGtin(lista);
      if (lista.length === 0) {
        somErro();
        vibrar([80, 60, 80]);
        toast.warning(`GTIN ${c} não está em nenhum pedido seu de remessa ativa.`);
        limpar();
        return;
      }
      const alvo = lista.find((i) => i.alvo);
      if (!alvo) {
        somAviso();
        toast.warning("Este produto já está completo em todas as suas lojas.");
        limpar();
        return;
      }
      if (modoRapido) {
        setItem(null);
        await registrar(alvo, 1, "entrada");
        focarBip();
        return;
      }
      setItem(alvo);
      setTipo("entrada");
      setQtd("1");
      requestAnimationFrame(() => {
        campoQtd.current?.focus();
        campoQtd.current?.select();
      });
    } finally {
      ocupado.current = false;
    }
  }

  const leitorBip = useLeitor(buscar);
  // Bipou outro produto com o campo de quantidade em foco: vira uma nova busca
  const leitorQtd = useLeitor((codigo) => {
    setQtd("1");
    buscar(codigo);
  });

  async function confirmar(e?: FormEvent) {
    e?.preventDefault();
    leitorQtd.cancelar();
    if (!item || gravando) return;
    if (/^\d{8,}$/.test(qtd.trim())) {
      const novo = qtd.trim();
      setQtd("1");
      buscar(novo);
      return;
    }
    if (!qtdValida) {
      somErro();
      toast.error(
        tipo === "entrada" ? `Quantidade deve ser de 1 a ${falta}` : `Ajuste deve ficar entre -${item.qtd_separada} e ${falta}`,
      );
      return;
    }
    const ok = await registrar(item, qtdNum, tipo);
    if (ok) limpar();
  }

  const totalPedido = lista.reduce((s, p) => s + p.qtd_pedido, 0);
  const totalSeparado = lista.reduce((s, p) => s + p.qtd_separada, 0);
  const completos = lista.filter((p) => p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido).length;
  const remessas = [...new Set(lista.map((p) => p.remessa_codigo))];
  const pedidoAtual = pedidoDe(item?.pedido_id);
  const pedidoUltimo = pedidoDe(ultimo?.pedidoId);
  const escuro = !!ultimo && modoRapido && ultimo.tipo !== "ajuste";

  return (
    <div className="flex h-dvh flex-col bg-fundo">
      {/* Topo */}
      <header className="shrink-0 bg-navy text-white">
        <div className="flex h-14 items-center gap-3 px-3 sm:h-16 sm:px-6">
          {perfil?.papel === "supervisor" && (
            <Link to="/painel" className="rounded-lg p-2 hover:bg-white/10" aria-label="Voltar ao painel" title="Voltar ao painel">
              <ArrowLeft className="size-5" />
            </Link>
          )}
          <Logo simbolo className="h-7 shrink-0 sm:h-8" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Separação</p>
            <p className="truncate text-xs text-white/65">
              {perfil?.nome}
              {remessas.length > 0 && ` · Remessa ${remessas.join(", ")}`}
            </p>
          </div>
          {lista.length > 0 && (
            <p className="tabular hidden text-right text-xs leading-tight text-white/70 md:block">
              <span className="block text-base font-semibold text-white">{fmtPct(totalSeparado, totalPedido)}</span>
              {fmtNum(totalSeparado)} de {fmtNum(totalPedido)} un.
            </p>
          )}
          <button
            type="button"
            onClick={() => setVerPedidos(true)}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/10 sm:px-3"
          >
            <ListChecks className="size-5" aria-hidden />
            <span className="hidden sm:inline">Meus pedidos</span>
            {lista.length > 0 && (
              <span className="tabular rounded-full bg-white/15 px-2 text-xs">
                {completos}/{lista.length}
              </span>
            )}
          </button>
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
        {lista.length > 0 && <Barra parte={totalSeparado} total={totalPedido} className="h-1 rounded-none bg-white/10" />}
      </header>

      {/* Campo de bip: pesquisa sozinho ao bipar */}
      <div className="shrink-0 border-b border-borda bg-white px-3 py-2.5 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            leitorBip.cancelar();
            buscar(gtin);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative min-w-0 flex-1">
            {buscando ? (
              <LoaderCircle className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 animate-spin text-azul" aria-hidden />
            ) : (
              <ScanBarcode className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-azul" aria-hidden />
            )}
            <label htmlFor="campo-gtin" className="sr-only">
              Bipe ou digite o GTIN
            </label>
            <input
              id="campo-gtin"
              ref={campoGtin}
              value={gtin}
              onChange={(e) => {
                leitorBip.digitou(e.target.value, gtin);
                setGtin(e.target.value);
              }}
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Bipe o produto"
              className="tabular h-14 w-full rounded-xl border-2 border-azul/30 bg-azul-claro/40 pr-3 pl-13 text-lg font-medium tracking-wide text-navy placeholder:font-normal placeholder:tracking-normal placeholder:text-suave/80 focus:border-azul focus:bg-white focus:outline-none sm:text-xl"
            />
          </div>
          <label
            className={cx(
              "flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm select-none",
              modoRapido ? "border-amarelo bg-amarelo-claro text-navy" : "border-borda text-suave",
            )}
            title="Modo rápido: cada bip já confirma 1 unidade na próxima loja"
          >
            <input
              type="checkbox"
              checked={modoRapido}
              onChange={(e) => {
                setModoRapido(e.target.checked);
                limpar();
              }}
              className="size-5 accent-azul"
            />
            <Zap className="size-4 text-amarelo" aria-hidden />
            <span className="hidden font-medium sm:inline">Modo rápido</span>
          </label>
        </form>
      </div>

      {/* Área principal: só a loja de destino */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-5">
        <div className="min-h-0 flex-1">
          {item && !modoRapido ? (
            <form onSubmit={confirmar} className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-borda">
              <div
                className={cx(
                  "flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden px-4 py-3 text-center text-white sm:gap-4",
                  tipo === "ajuste" ? "bg-[#5c3d00]" : "bg-navy",
                )}
                aria-live="assertive"
              >
                <p className="text-xs font-semibold tracking-[0.2em] text-amarelo uppercase sm:text-base">
                  {tipo === "ajuste" ? "Ajuste na loja" : "Leve para a loja"}
                </p>
                <div className="flex max-w-full items-center gap-3 sm:gap-5">
                  <SeloLoja
                    numero={item.loja_numero}
                    nome={item.loja_nome}
                    className="size-16 text-3xl sm:size-24 sm:text-5xl lg:size-32 lg:text-7xl"
                  />
                  <p className="min-w-0 text-left text-3xl leading-tight font-semibold break-words sm:text-5xl lg:text-7xl">
                    {item.loja_nome}
                  </p>
                </div>
                <div className="flex w-full max-w-2xl gap-2 sm:gap-3">
                  <Numero rotulo="Pedido" valor={item.qtd_pedido} />
                  <Numero rotulo="Separado" valor={item.qtd_separada} />
                  <Numero rotulo="Falta" valor={falta} destaque />
                </div>
              </div>

              <div className="shrink-0 space-y-3 p-3 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold sm:text-xl">{item.produto}</p>
                    <p className="tabular text-xs text-suave">GTIN {item.gtin}</p>
                  </div>
                  <div className="tabular grid grid-cols-2 gap-x-6 text-sm">
                    {pedidoAtual && (
                      <div>
                        <p className="text-xs text-suave">Total da loja</p>
                        <p className="font-semibold">
                          {fmtNum(pedidoAtual.qtd_separada)} de {fmtNum(pedidoAtual.qtd_pedido)} un.{" "}
                          <span className="font-normal text-suave">· falta {fmtNum(pedidoAtual.qtd_pedido - pedidoAtual.qtd_separada)}</span>
                        </p>
                        <Barra parte={pedidoAtual.qtd_separada} total={pedidoAtual.qtd_pedido} className="mt-1 h-1.5" />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-suave">Este produto nas outras lojas</p>
                      <p className="font-semibold">
                        {faltaOutras > 0 ? (
                          <>
                            falta {fmtNum(faltaOutras)} em {outrasLojas.length} {outrasLojas.length === 1 ? "loja" : "lojas"}
                          </>
                        ) : (
                          <span className="text-ciano-escuro">nenhuma pendente</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => setQtd(String((Number(qtd) || 0) - 1))}
                    className="grid w-14 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo"
                    aria-label="Diminuir"
                  >
                    <Minus className="size-5" />
                  </button>
                  <label htmlFor="campo-qtd" className="sr-only">
                    Quantidade
                  </label>
                  <input
                    id="campo-qtd"
                    ref={campoQtd}
                    value={qtd}
                    onChange={(e) => {
                      leitorQtd.digitou(e.target.value, qtd);
                      setQtd(e.target.value.replace(/[^\d-]/g, ""));
                    }}
                    inputMode={tipo === "ajuste" ? "text" : "numeric"}
                    autoComplete="off"
                    enterKeyHint="done"
                    className={cx(
                      "tabular h-14 w-20 min-w-0 shrink-0 rounded-xl border-2 text-center text-2xl font-semibold focus:outline-none sm:w-28",
                      qtdValida ? "border-borda focus:border-azul" : "border-erro text-erro",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setQtd(String((Number(qtd) || 0) + 1))}
                    className="grid w-14 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo"
                    aria-label="Aumentar"
                  >
                    <Plus className="size-5" />
                  </button>
                  <button
                    type="submit"
                    disabled={!qtdValida || gravando}
                    className={cx(
                      "flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      tipo === "ajuste" ? "bg-navy text-white hover:bg-navy-700" : "bg-ciano text-navy hover:bg-[#00b2a3]",
                    )}
                  >
                    <Check className="size-6" aria-hidden />
                    {tipo === "ajuste" ? "Confirmar ajuste" : "Confirmar"}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <button type="button" onClick={limpar} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-suave hover:bg-fundo">
                    <X className="size-4" /> Cancelar
                  </button>
                  <div className="flex gap-1">
                    {tipo === "entrada" && falta > 1 && (
                      <button
                        type="button"
                        onClick={() => setQtd(String(falta))}
                        className="rounded-lg px-3 py-1.5 font-medium text-navy hover:bg-fundo"
                      >
                        Tudo ({falta})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setTipo(tipo === "ajuste" ? "entrada" : "ajuste");
                        setQtd(tipo === "ajuste" ? "1" : "-1");
                        campoQtd.current?.focus();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-navy hover:bg-fundo"
                    >
                      <Undo2 className="size-4" />
                      {tipo === "ajuste" ? "Voltar" : "Ajuste"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          ) : ultimo ? (
            /* Depois do bip: a loja onde o produto foi colocado, em destaque */
            <div
              className={cx(
                "flex h-full flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl px-4 text-center sm:gap-4",
                ultimo.tipo === "ajuste" ? "bg-amarelo-claro text-navy" : escuro ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-borda",
              )}
              aria-live="polite"
            >
              <p className={cx("text-xs font-semibold tracking-[0.2em] uppercase sm:text-base", escuro ? "text-amarelo" : "text-ciano-escuro")}>
                {ultimo.tipo === "ajuste" ? "Ajuste feito" : modoRapido ? "Leve para a loja" : "Registrado"}
              </p>
              <div className="flex max-w-full items-center gap-3 sm:gap-5">
                <SeloLoja
                  numero={ultimo.lojaNumero}
                  nome={ultimo.lojaNome}
                  className={cx(escuro ? "size-16 text-3xl sm:size-24 sm:text-5xl lg:size-32 lg:text-7xl" : "size-14 text-2xl sm:size-20 sm:text-4xl")}
                />
                <p
                  className={cx(
                    "min-w-0 text-left leading-tight font-semibold break-words",
                    escuro ? "text-3xl sm:text-5xl lg:text-7xl" : "text-2xl sm:text-4xl",
                  )}
                >
                  {ultimo.lojaNome}
                </p>
              </div>
              <p className={cx("text-base sm:text-lg", escuro ? "text-white/75" : "text-suave")}>
                <strong className={escuro ? "text-white" : "text-navy"}>
                  {ultimo.qtd > 0 ? "+" : ""}
                  {ultimo.qtd}
                </strong>{" "}
                · {ultimo.produto}
              </p>
              <div
                className={cx(
                  "tabular flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm",
                  escuro ? "text-white/75" : "text-suave",
                )}
              >
                <span>
                  Produto na loja:{" "}
                  <strong className={escuro ? "text-white" : "text-navy"}>
                    {ultimo.separado}/{ultimo.pedido}
                  </strong>
                  {ultimo.pedido - ultimo.separado > 0 ? ` · falta ${ultimo.pedido - ultimo.separado}` : " · completo"}
                </span>
                {pedidoUltimo && (
                  <span>
                    Total da loja:{" "}
                    <strong className={escuro ? "text-white" : "text-navy"}>
                      {fmtNum(pedidoUltimo.qtd_separada)}/{fmtNum(pedidoUltimo.qtd_pedido)}
                    </strong>{" "}
                    · {fmtPct(pedidoUltimo.qtd_separada, pedidoUltimo.qtd_pedido)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={desfazerUltimo}
                disabled={gravando}
                className={cx(
                  "mt-1 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50",
                  escuro ? "bg-white/10 text-white hover:bg-white/20" : "bg-fundo text-navy hover:bg-borda/60",
                )}
              >
                <Undo2 className="size-4" /> Desfazer
              </button>
            </div>
          ) : (
            /* Esperando o primeiro bip */
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl bg-white px-4 text-center ring-1 ring-borda">
              <span className="grid size-20 place-items-center rounded-full bg-azul-claro text-azul sm:size-24">
                <ScanBarcode className="size-10 sm:size-12" aria-hidden />
              </span>
              <p className="text-2xl font-semibold sm:text-3xl">Bipe o produto</p>
              {pedidos.carregando && !pedidos.dados ? (
                <p className="text-sm text-suave">Carregando seus pedidos…</p>
              ) : lista.length === 0 ? (
                <p className="max-w-md text-sm text-suave">
                  Você ainda não tem pedidos em remessa ativa. Quando o supervisor distribuir e ativar, é só bipar.
                </p>
              ) : (
                <div className="w-full max-w-sm">
                  <p className="tabular text-sm text-suave">
                    {fmtNum(totalSeparado)} de {fmtNum(totalPedido)} unidades · {completos} de {lista.length} lojas completas
                  </p>
                  <Barra parte={totalSeparado} total={totalPedido} className="mt-2 h-2.5" />
                  <p className="tabular mt-1 text-lg font-semibold">{fmtPct(totalSeparado, totalPedido)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Últimos bips */}
        <section className="flex h-40 shrink-0 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-borda sm:h-52 lg:h-60" aria-label="Últimos bips">
          <h2 className="flex shrink-0 items-center gap-2 border-b border-borda px-4 py-2 text-sm font-semibold">
            <History className="size-4 text-azul" aria-hidden /> Últimos bips
          </h2>
          {(bips.dados ?? []).length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-sm text-suave">Os seus bips aparecem aqui.</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-borda overflow-y-auto">
              {(bips.dados ?? []).map((b, i) => (
                <li key={b.id} className={cx("flex items-center gap-3 px-4 py-1.5 text-sm", i === 0 && "bg-azul-claro/40")}>
                  <time className="tabular w-16 shrink-0 text-xs text-suave" dateTime={b.criado_em}>
                    {hora(b.criado_em)}
                  </time>
                  <span
                    className={cx(
                      "tabular w-10 shrink-0 rounded-md py-0.5 text-center text-xs font-semibold",
                      b.tipo === "ajuste" ? "bg-amarelo-claro text-[#7a5200]" : "bg-ciano-claro text-ciano-escuro",
                    )}
                  >
                    {b.qtd > 0 ? "+" : ""}
                    {b.qtd}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{b.produto}</span>
                  <span className="flex shrink-0 items-center gap-2 font-medium">
                    <SeloLoja numero={b.loja_numero} nome={b.loja_nome} className="size-6 text-[11px]" />
                    <span className="hidden max-w-40 truncate sm:inline">{b.loja_nome}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Meus pedidos (fica num botão para não poluir a tela) */}
      <Modal
        aberto={verPedidos}
        aoFechar={() => {
          setVerPedidos(false);
          focarBip();
        }}
        titulo="Meus pedidos"
        largura="max-w-2xl"
      >
        {pedidos.carregando && !pedidos.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio titulo="Nenhum pedido para você agora">Quando o supervisor ativar uma remessa e distribuir os pedidos, eles aparecem aqui.</Vazio>
        ) : (
          <ul className="max-h-[65vh] space-y-2 overflow-y-auto">
            {lista.map((p) => {
              const completo = p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido;
              return (
                <li key={p.id} className={cx("flex items-center gap-3 rounded-2xl p-3 ring-1", completo ? "ring-ciano/50" : "ring-borda")}>
                  <SeloLoja numero={p.loja_numero} nome={p.loja_nome} className="size-11 text-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold">{p.loja_nome}</p>
                      <span className={cx("tabular shrink-0 text-sm font-semibold", completo && "text-ciano-escuro")}>
                        {completo ? "Completo" : `${fmtNum(p.qtd_separada)}/${fmtNum(p.qtd_pedido)} · falta ${fmtNum(p.qtd_pedido - p.qtd_separada)}`}
                      </span>
                    </div>
                    <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-2" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </div>
  );
}
