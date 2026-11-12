import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Check, ListChecks, LogOut, Minus, Plus, ScanBarcode, Undo2, X, Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum, fmtPct, nomeLoja } from "../lib/formato";
import { somAviso, somErro, somOk, vibrar } from "../lib/som";
import type { ItemDoGtin, PedidoResumo, TipoBip } from "../lib/tipos";
import { Logo } from "../components/Logo";
import { Barra, Carregando, Modal, Vazio, cx } from "../components/ui";

const CHAVE_MODO_RAPIDO = "wms.modoRapido";

function lerModoRapido() {
  try {
    return localStorage.getItem(CHAVE_MODO_RAPIDO) === "1";
  } catch {
    return false;
  }
}

interface Ultimo {
  itemId: number;
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

export default function Separacao() {
  const { perfil, sair } = useAuth();
  const [gtin, setGtin] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [item, setItem] = useState<ItemDoGtin | null>(null);
  const [qtd, setQtd] = useState("1");
  const [tipo, setTipo] = useState<TipoBip>("entrada");
  const [gravando, setGravando] = useState(false);
  const [modoRapido, setModoRapido] = useState(lerModoRapido);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [verPedidos, setVerPedidos] = useState(false);
  const campoGtin = useRef<HTMLInputElement>(null);
  const campoQtd = useRef<HTMLInputElement>(null);

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

  const falta = item ? item.qtd_pedido - item.qtd_separada : 0;
  const qtdNum = Number(qtd);
  const qtdValida =
    !!item &&
    qtd.trim() !== "" &&
    Number.isInteger(qtdNum) &&
    qtdNum !== 0 &&
    (tipo === "entrada" ? qtdNum > 0 && qtdNum <= falta : qtdNum >= -item.qtd_separada && qtdNum <= falta);

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
    setUltimo({
      itemId: alvo.item_id,
      produto: alvo.produto,
      lojaNome: alvo.loja_nome,
      lojaNumero: alvo.loja_numero,
      qtd: quantidade,
      tipo: tipoBip,
      separado: novo,
      pedido: alvo.qtd_pedido,
    });
    pedidos.recarregar();
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
    focarBip();
  }

  async function buscar(codigo: string) {
    const c = codigo.replace(/\s/g, "");
    if (!c) return;
    setBuscando(true);
    const { data, error } = await supabase.rpc("itens_do_gtin", { p_gtin: c });
    setBuscando(false);
    setGtin("");
    if (error) {
      somErro();
      toast.error(mensagemErro(error));
      focarBip();
      return;
    }
    const lista = (data ?? []) as ItemDoGtin[];
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
  }

  async function confirmar(e?: FormEvent) {
    e?.preventDefault();
    if (!item || gravando) return;
    // Bipou outro código com o campo de quantidade em foco: trata como novo GTIN
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

  const lista = pedidos.dados ?? [];
  const totalPedido = lista.reduce((s, p) => s + p.qtd_pedido, 0);
  const totalSeparado = lista.reduce((s, p) => s + p.qtd_separada, 0);
  const completos = lista.filter((p) => p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido).length;
  const remessas = [...new Set(lista.map((p) => p.remessa_codigo))];

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

      {/* Campo de bip, sempre no topo */}
      <div className="shrink-0 border-b border-borda bg-white px-3 py-3 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar(gtin);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <ScanBarcode className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-azul" aria-hidden />
            <label htmlFor="campo-gtin" className="sr-only">
              Bipe ou digite o GTIN
            </label>
            <input
              id="campo-gtin"
              ref={campoGtin}
              value={gtin}
              onChange={(e) => setGtin(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Bipe o produto"
              className="tabular h-14 w-full rounded-xl border-2 border-azul/30 bg-azul-claro/40 pr-3 pl-13 text-lg font-medium tracking-wide text-navy placeholder:font-normal placeholder:tracking-normal placeholder:text-suave/80 focus:border-azul focus:bg-white focus:outline-none sm:text-xl"
            />
          </div>
          <button
            type="submit"
            disabled={buscando}
            className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-navy text-white hover:bg-navy-700 disabled:opacity-50 sm:w-auto sm:px-6"
            aria-label="Buscar"
          >
            <ScanBarcode className="size-6 sm:hidden" aria-hidden />
            <span className="hidden font-medium sm:inline">Buscar</span>
          </button>
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
      <main className="min-h-0 flex-1 p-3 sm:p-6">
        {item && !modoRapido ? (
          <form onSubmit={confirmar} className="flex h-full flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-borda">
            <div
              className={cx(
                "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-4 text-center text-white sm:gap-5",
                tipo === "ajuste" ? "bg-[#5c3d00]" : "bg-navy",
              )}
              aria-live="assertive"
            >
              <p className="text-sm font-semibold tracking-[0.2em] text-amarelo uppercase sm:text-base">
                {tipo === "ajuste" ? "Ajuste na loja" : "Leve para a loja"}
              </p>
              <SeloLoja
                numero={item.loja_numero}
                nome={item.loja_nome}
                className="size-24 text-5xl sm:size-36 sm:text-7xl lg:size-44 lg:text-8xl"
              />
              <p className="max-w-full text-4xl leading-tight font-semibold break-words sm:text-6xl lg:text-7xl">{item.loja_nome}</p>
              <p className="text-sm text-white/60">Pedido {item.pedido_nome}</p>
            </div>

            <div className="shrink-0 space-y-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold sm:text-xl">{item.produto}</p>
                  <p className="tabular text-xs text-suave">GTIN {item.gtin}</p>
                </div>
                <p className="tabular text-sm text-suave">
                  Separado <strong className="text-navy">{item.qtd_separada}</strong> de {item.qtd_pedido} ·{" "}
                  <span className="font-semibold text-[#7a5200]">falta {falta}</span>
                </p>
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
                  onChange={(e) => setQtd(e.target.value.replace(/[^\d-]/g, ""))}
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
                <button type="button" onClick={limpar} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-suave hover:bg-fundo">
                  <X className="size-4" /> Cancelar
                </button>
                <div className="flex gap-1">
                  {tipo === "entrada" && falta > 1 && (
                    <button
                      type="button"
                      onClick={() => setQtd(String(falta))}
                      className="rounded-lg px-3 py-2 font-medium text-navy hover:bg-fundo"
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
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-navy hover:bg-fundo"
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
              "flex h-full flex-col items-center justify-center gap-3 rounded-3xl px-4 text-center sm:gap-5",
              ultimo.tipo === "ajuste" ? "bg-amarelo-claro text-navy" : modoRapido ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-borda",
            )}
            aria-live="polite"
          >
            <p
              className={cx(
                "text-sm font-semibold tracking-[0.2em] uppercase sm:text-base",
                modoRapido && ultimo.tipo !== "ajuste" ? "text-amarelo" : "text-ciano-escuro",
              )}
            >
              {ultimo.tipo === "ajuste" ? "Ajuste feito" : modoRapido ? "Leve para a loja" : "Registrado"}
            </p>
            <SeloLoja
              numero={ultimo.lojaNumero}
              nome={ultimo.lojaNome}
              className={cx(modoRapido ? "size-24 text-5xl sm:size-36 sm:text-7xl lg:size-44 lg:text-8xl" : "size-20 text-4xl sm:size-24 sm:text-5xl")}
            />
            <p className={cx("max-w-full leading-tight font-semibold break-words", modoRapido ? "text-4xl sm:text-6xl lg:text-7xl" : "text-3xl sm:text-4xl")}>
              {ultimo.lojaNome}
            </p>
            <p className={cx("text-base sm:text-lg", modoRapido && ultimo.tipo !== "ajuste" ? "text-white/75" : "text-suave")}>
              <strong className={modoRapido && ultimo.tipo !== "ajuste" ? "text-white" : "text-navy"}>
                {ultimo.qtd > 0 ? "+" : ""}
                {ultimo.qtd}
              </strong>{" "}
              · {ultimo.produto} ·{" "}
              <span className="tabular">
                {ultimo.separado}/{ultimo.pedido}
              </span>
            </p>
            <button
              type="button"
              onClick={desfazerUltimo}
              disabled={gravando}
              className={cx(
                "mt-2 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50",
                modoRapido && ultimo.tipo !== "ajuste" ? "bg-white/10 text-white hover:bg-white/20" : "bg-fundo text-navy hover:bg-borda/60",
              )}
            >
              <Undo2 className="size-4" /> Desfazer
            </button>
            <p className={cx("text-xs", modoRapido && ultimo.tipo !== "ajuste" ? "text-white/50" : "text-suave")}>Bipe o próximo produto</p>
          </div>
        ) : (
          /* Esperando o primeiro bip */
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-3xl bg-white px-4 text-center ring-1 ring-borda">
            <span className="grid size-24 place-items-center rounded-full bg-azul-claro text-azul sm:size-28">
              <ScanBarcode className="size-12 sm:size-14" aria-hidden />
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
      </main>

      {/* Meus pedidos (fica num botão para não poluir a tela) */}
      <Modal aberto={verPedidos} aoFechar={() => { setVerPedidos(false); focarBip(); }} titulo="Meus pedidos" largura="max-w-2xl">
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
                        {completo ? "Completo" : `${fmtNum(p.qtd_separada)}/${fmtNum(p.qtd_pedido)}`}
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
