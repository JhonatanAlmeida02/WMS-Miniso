import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  LayoutDashboard,
  LogOut,
  Minus,
  PackageCheck,
  Plus,
  ScanBarcode,
  Store,
  Undo2,
  Zap,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum, fmtPct, nomeLoja } from "../lib/formato";
import { somAviso, somErro, somOk, vibrar } from "../lib/som";
import type { ItemDoGtin, PedidoResumo, TipoBip } from "../lib/tipos";
import { Logo } from "../components/Logo";
import { Barra, Botao, Carregando, Vazio, cx } from "../components/ui";

const CHAVE_MODO_RAPIDO = "wms.modoRapido";

function lerModoRapido() {
  try {
    return localStorage.getItem(CHAVE_MODO_RAPIDO) === "1";
  } catch {
    return false;
  }
}

interface Ultimo {
  produto: string;
  loja: string;
  qtd: number;
  tipo: TipoBip;
}

export default function Separacao() {
  const { perfil, sair } = useAuth();
  const [gtin, setGtin] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [itens, setItens] = useState<ItemDoGtin[] | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [qtd, setQtd] = useState("1");
  const [tipo, setTipo] = useState<TipoBip>("entrada");
  const [gravando, setGravando] = useState(false);
  const [modoRapido, setModoRapido] = useState(lerModoRapido);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
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

  const item = itens?.find((i) => i.item_id === escolhido) ?? null;
  const falta = item ? item.qtd_pedido - item.qtd_separada : 0;
  const qtdNum = Number(qtd);
  const qtdValida =
    qtd.trim() !== "" &&
    Number.isInteger(qtdNum) &&
    qtdNum !== 0 &&
    (tipo === "entrada" ? qtdNum > 0 && qtdNum <= falta : qtdNum >= -(item?.qtd_separada ?? 0) && qtdNum <= falta);

  function focarBip() {
    requestAnimationFrame(() => campoGtin.current?.focus());
  }

  function limpar() {
    setItens(null);
    setEscolhido(null);
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
    const novo = (data as { qtd_separada: number }[])[0]?.qtd_separada;
    setUltimo({ produto: alvo.produto, loja: nomeLoja(alvo.loja_nome, alvo.loja_numero), qtd: quantidade, tipo: tipoBip });
    toast.success(
      `${quantidade > 0 ? "+" : ""}${quantidade} un. → ${nomeLoja(alvo.loja_nome, alvo.loja_numero)}` +
        (novo != null ? ` (${novo}/${alvo.qtd_pedido})` : ""),
      { duration: 2500 },
    );
    pedidos.recarregar();
    return true;
  }

  async function buscar(codigo: string) {
    const c = codigo.replace(/\s/g, "");
    if (!c) return;
    setBuscando(true);
    const { data, error } = await supabase.rpc("itens_do_gtin", { p_gtin: c });
    setBuscando(false);
    if (error) {
      somErro();
      toast.error(mensagemErro(error));
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
      toast.warning("Todos os seus pedidos deste produto já estão completos.");
      setItens(lista);
      setEscolhido(null);
      setGtin("");
      focarBip();
      return;
    }
    if (modoRapido) {
      setItens(lista);
      setEscolhido(alvo.item_id);
      const ok = await registrar(alvo, 1, "entrada");
      if (ok) {
        // atualiza a lista mostrada com o novo saldo
        const { data: novo } = await supabase.rpc("itens_do_gtin", { p_gtin: c });
        setItens((novo ?? []) as ItemDoGtin[]);
      }
      setGtin("");
      focarBip();
      return;
    }
    setItens(lista);
    setEscolhido(alvo.item_id);
    setTipo("entrada");
    setQtd("1");
    setGtin("");
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
      setQtd("1");
      buscar(qtd.trim());
      return;
    }
    if (!qtdValida) {
      somErro();
      toast.error(
        tipo === "entrada"
          ? `Quantidade deve ser de 1 a ${falta}`
          : `Ajuste deve ficar entre -${item.qtd_separada} e ${falta}`,
      );
      return;
    }
    const ok = await registrar(item, qtdNum, tipo);
    if (ok) limpar();
  }

  const lista = pedidos.dados ?? [];
  const totalPedido = lista.reduce((s, p) => s + p.qtd_pedido, 0);
  const totalSeparado = lista.reduce((s, p) => s + p.qtd_separada, 0);
  const remessas = [...new Set(lista.map((p) => p.remessa_codigo))];

  return (
    <div className="min-h-dvh bg-fundo pb-10">
      <header className="sticky top-0 z-20 bg-navy text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          {perfil?.papel === "supervisor" ? (
            <Link to="/painel" className="-ml-2 rounded-lg p-2 hover:bg-white/10" aria-label="Voltar ao painel" title="Voltar ao painel">
              <ArrowLeft className="size-5" />
            </Link>
          ) : null}
          <Logo simbolo className="h-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Separação</p>
            <p className="truncate text-xs text-white/65">
              {perfil?.nome}
              {remessas.length > 0 && ` · Remessa ${remessas.join(", ")}`}
            </p>
          </div>
          {perfil?.papel === "supervisor" && (
            <Link to="/painel" className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 sm:flex">
              <LayoutDashboard className="size-4" /> Painel
            </Link>
          )}
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {/* Bipagem */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-borda sm:p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              buscar(gtin);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
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
                placeholder="Bipe o GTIN"
                className="tabular h-16 w-full rounded-xl border-2 border-azul/30 bg-azul-claro/40 pr-3 pl-13 text-lg font-medium sm:text-xl tracking-wide text-navy placeholder:font-normal placeholder:tracking-normal placeholder:text-suave/80 focus:border-azul focus:bg-white focus:outline-none"
              />
            </div>
            <Botao type="submit" tamanho="lg" className="h-16 px-5" carregando={buscando} aria-label="Buscar GTIN">
              <span className="hidden sm:inline">Buscar</span>
              {!buscando && <ScanBarcode className="size-5 sm:hidden" aria-hidden />}
            </Botao>
          </form>
          <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-suave select-none">
            <input
              type="checkbox"
              checked={modoRapido}
              onChange={(e) => {
                setModoRapido(e.target.checked);
                focarBip();
              }}
              className="size-5 accent-azul"
            />
            <span>
              <Zap className="mr-1 inline size-4 text-amarelo" aria-hidden />
              <strong className="font-medium text-navy">Modo rápido:</strong> cada bip já confirma 1 unidade na próxima loja
            </span>
          </label>
        </section>

        {/* Destino do item bipado */}
        {item && !modoRapido && (
          <form onSubmit={confirmar} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-2 ring-azul">
            <div className={cx("px-5 py-4 text-white", tipo === "ajuste" ? "bg-[#7a5200]" : "bg-navy")}>
              <p className="text-xs font-medium tracking-[0.16em] text-amarelo uppercase">
                {tipo === "ajuste" ? "Ajuste na loja" : "Colocar na loja"}
              </p>
              <p className="mt-1 flex items-center gap-3 text-3xl font-semibold sm:text-4xl">
                <Store className="size-8 shrink-0 text-ciano" aria-hidden />
                <span className="min-w-0 break-words">{nomeLoja(item.loja_nome, item.loja_numero)}</span>
              </p>
              <p className="mt-1 text-sm text-white/70">
                Pedido {item.pedido_nome} · Remessa {item.remessa_codigo}
              </p>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="text-lg leading-snug font-medium text-navy">{item.produto}</p>
                <p className="tabular text-sm text-suave">GTIN {item.gtin}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-fundo p-2">
                  <p className="text-xs text-suave">Pedido</p>
                  <p className="tabular text-xl font-semibold">{item.qtd_pedido}</p>
                </div>
                <div className="rounded-xl bg-fundo p-2">
                  <p className="text-xs text-suave">Separado</p>
                  <p className="tabular text-xl font-semibold">{item.qtd_separada}</p>
                </div>
                <div className="rounded-xl bg-amarelo-claro p-2">
                  <p className="text-xs text-[#7a5200]">Falta</p>
                  <p className="tabular text-xl font-semibold">{falta}</p>
                </div>
              </div>

              <div>
                <label htmlFor="campo-qtd" className="mb-1.5 block text-sm font-medium">
                  {tipo === "ajuste" ? "Quantidade do ajuste (negativo tira)" : "Quantidade"}
                </label>
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => setQtd(String((Number(qtd) || 0) - 1))}
                    className="grid w-14 place-items-center rounded-xl border border-borda text-navy hover:bg-fundo"
                    aria-label="Diminuir"
                  >
                    <Minus className="size-5" />
                  </button>
                  <input
                    id="campo-qtd"
                    ref={campoQtd}
                    value={qtd}
                    onChange={(e) => setQtd(e.target.value.replace(/[^\d-]/g, ""))}
                    inputMode={tipo === "ajuste" ? "text" : "numeric"}
                    autoComplete="off"
                    enterKeyHint="done"
                    className={cx(
                      "tabular h-14 min-w-0 flex-1 rounded-xl border-2 text-center text-2xl font-semibold focus:outline-none",
                      qtdValida ? "border-borda focus:border-azul" : "border-erro text-erro",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setQtd(String((Number(qtd) || 0) + 1))}
                    className="grid w-14 place-items-center rounded-xl border border-borda text-navy hover:bg-fundo"
                    aria-label="Aumentar"
                  >
                    <Plus className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setQtd(String(tipo === "ajuste" ? -item.qtd_separada : falta))}
                    className="rounded-xl border border-borda px-3 text-sm font-medium text-navy hover:bg-fundo"
                  >
                    {tipo === "ajuste" ? "Zerar" : "Tudo"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Botao variante="secundario" tamanho="lg" onClick={limpar} className="sm:w-auto">
                  Cancelar
                </Botao>
                <Botao
                  variante="fantasma"
                  tamanho="lg"
                  icone={<Undo2 className="size-5" />}
                  onClick={() => {
                    setTipo(tipo === "ajuste" ? "entrada" : "ajuste");
                    setQtd(tipo === "ajuste" ? "1" : "-1");
                    campoQtd.current?.focus();
                  }}
                >
                  {tipo === "ajuste" ? "Voltar para entrada" : "Ajuste / estorno"}
                </Botao>
                <Botao
                  type="submit"
                  variante={tipo === "ajuste" ? "primario" : "sucesso"}
                  tamanho="lg"
                  className="sm:ml-auto sm:min-w-48"
                  carregando={gravando}
                  disabled={!qtdValida}
                  icone={<Check className="size-5" />}
                >
                  {tipo === "ajuste" ? "Confirmar ajuste" : "Confirmar bip"}
                </Botao>
              </div>
            </div>
          </form>
        )}

        {/* No modo rápido, destaque grande da última loja */}
        {modoRapido && ultimo && (
          <div
            className={cx(
              "rounded-2xl px-5 py-4 text-navy shadow-sm",
              ultimo.tipo === "ajuste" ? "bg-amarelo-claro" : "bg-ciano",
            )}
            aria-live="polite"
          >
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">Último bip</p>
            <p className="mt-1 text-3xl font-semibold">{ultimo.loja}</p>
            <p className="text-sm">
              {ultimo.qtd > 0 ? "+" : ""}
              {ultimo.qtd} · {ultimo.produto}
            </p>
          </div>
        )}

        {/* Todas as lojas desse produto */}
        {itens && itens.length > 0 && (
          <section className="rounded-2xl bg-white shadow-sm ring-1 ring-borda">
            <h2 className="border-b border-borda px-4 py-3 text-sm font-semibold">
              Este produto nos seus pedidos{" "}
              <span className="font-normal text-suave">({itens.length} {itens.length === 1 ? "loja" : "lojas"})</span>
            </h2>
            <ul className="divide-y divide-borda">
              {itens.map((i) => {
                const completo = i.qtd_separada >= i.qtd_pedido;
                const selecionado = i.item_id === escolhido && !modoRapido;
                return (
                  <li key={i.item_id}>
                    <button
                      type="button"
                      disabled={modoRapido}
                      onClick={() => {
                        setEscolhido(i.item_id);
                        setTipo(completo ? "ajuste" : "entrada");
                        setQtd(completo ? "-1" : "1");
                        requestAnimationFrame(() => campoQtd.current?.select());
                      }}
                      className={cx(
                        "flex w-full items-center gap-3 px-4 py-3 text-left",
                        selecionado ? "bg-azul-claro" : "hover:bg-fundo",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{nomeLoja(i.loja_nome, i.loja_numero)}</span>
                        <span className="block text-xs text-suave">Pedido {i.pedido_nome}</span>
                      </span>
                      <span className={cx("tabular text-sm font-semibold", completo ? "text-ciano-escuro" : "text-navy")}>
                        {i.qtd_separada}/{i.qtd_pedido}
                      </span>
                      {completo && <PackageCheck className="size-5 text-ciano-escuro" aria-label="Completo" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Meus pedidos */}
        <section>
          <div className="mb-2 flex items-end justify-between px-1">
            <h2 className="font-semibold">Meus pedidos</h2>
            {lista.length > 0 && (
              <p className="tabular text-sm text-suave">
                {fmtNum(totalSeparado)} de {fmtNum(totalPedido)} un. · <strong className="text-navy">{fmtPct(totalSeparado, totalPedido)}</strong>
              </p>
            )}
          </div>
          {lista.length > 0 && <Barra parte={totalSeparado} total={totalPedido} className="mb-3 h-2.5" />}
          {pedidos.carregando && !pedidos.dados ? (
            <Carregando />
          ) : lista.length === 0 ? (
            <div className="rounded-2xl bg-white ring-1 ring-borda">
              <Vazio icone={<Store className="size-8" />} titulo="Nenhum pedido para você agora">
                Quando o supervisor ativar uma remessa e distribuir os pedidos, eles aparecem aqui.
              </Vazio>
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {lista.map((p) => {
                const completo = p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido;
                return (
                  <li key={p.id} className={cx("rounded-2xl bg-white p-4 ring-1", completo ? "ring-ciano/50" : "ring-borda")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{nomeLoja(p.loja_nome, p.loja_numero)}</p>
                        <p className="text-xs text-suave">
                          Pedido {p.nome} · {p.itens_completos}/{p.itens} itens
                        </p>
                      </div>
                      {completo ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ciano-claro px-2 py-0.5 text-xs font-semibold text-ciano-escuro">
                          <Check className="size-3.5" /> Completo
                        </span>
                      ) : (
                        <span className="tabular text-sm font-semibold">{fmtPct(p.qtd_separada, p.qtd_pedido)}</span>
                      )}
                    </div>
                    <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-3" />
                    <p className="tabular mt-1.5 text-xs text-suave">
                      {fmtNum(p.qtd_separada)} de {fmtNum(p.qtd_pedido)} unidades
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
