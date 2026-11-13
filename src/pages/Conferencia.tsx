import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCheck, ChevronDown, ClipboardCheck, Download, ScanBarcode, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { useRemessaEscolhida } from "../lib/useRemessaEscolhida";
import { baixarCsv, buscarTudo } from "../lib/buscarTudo";
import { alterarStatus } from "../lib/remessa";
import { fmtNum, nomeLoja } from "../lib/formato";
import { Barra, Botao, Cartao, Carregando, SeloStatus, Selecao, Titulo, Vazio, classesBotao, cx, useConfirmacao } from "../components/ui";
import { ConferenciaFisica } from "../components/ConferenciaFisica";

interface LinhaConferencia {
  gtin: string;
  produto: string;
  qtd_pedido: number;
  qtd_separada: number;
  lojas: number;
  lojas_divergentes: number;
}

interface ItemLoja {
  id: number;
  loja_nome: string;
  loja_numero: number | null;
  pedido_nome: string;
  operador_nome: string | null;
  qtd_pedido: number;
  qtd_separada: number;
}

function LojasDoGtin({ remessa, gtin }: { remessa: number; gtin: string }) {
  const { dados } = useConsulta<ItemLoja[]>(
    () =>
      supabase
        .from("v_itens")
        .select("id,loja_nome,loja_numero,pedido_nome,operador_nome,qtd_pedido,qtd_separada")
        .eq("remessa_id", remessa)
        .eq("gtin", gtin)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome"),
    [remessa, gtin],
    { tabelas: ["bips"] },
  );
  if (!dados) return <p className="px-5 py-3 text-sm text-suave">Carregando lojas…</p>;
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-borda/70">
        {dados.map((i) => {
          const dif = i.qtd_separada - i.qtd_pedido;
          return (
            <tr key={i.id}>
              <td className="py-2 pr-3 pl-12">
                {nomeLoja(i.loja_nome, i.loja_numero)}
                <span className="block text-xs text-suave">
                  Pedido {i.pedido_nome} · {i.operador_nome ?? "sem operador"}
                </span>
              </td>
              <td className="tabular px-3 py-2 text-right">
                {i.qtd_separada}/{i.qtd_pedido}
              </td>
              <td className={cx("tabular w-24 px-5 py-2 text-right font-semibold", dif === 0 ? "text-ciano-escuro" : "text-erro")}>
                {dif === 0 ? "ok" : dif}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Conferencia() {
  const { lista: remessas, escolhida, escolher, carregando } = useRemessaEscolhida(true);
  const [busca, setBusca] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [confirmar, dialogo] = useConfirmacao();
  const [ocupado, setOcupado] = useState(false);
  const [params, setParams] = useSearchParams();
  const aba = params.get("aba") === "fisica" ? "fisica" : "separacao";
  const trocarAba = (a: "separacao" | "fisica") => {
    const n = new URLSearchParams(params);
    n.set("aba", a);
    setParams(n, { replace: true });
  };

  const conf = useConsulta<LinhaConferencia[]>(
    () =>
      buscarTudo<LinhaConferencia>((de, ate) =>
        supabase.rpc("conferencia_remessa", { p_remessa: escolhida?.id ?? -1 }).range(de, ate),
      ),
    [escolhida?.id],
    { tabelas: ["bips"], ativo: !!escolhida, atraso: 2000 },
  );

  const linhas = conf.dados ?? [];
  const resumo = useMemo(() => {
    const div = linhas.filter((l) => l.lojas_divergentes > 0);
    return {
      produtos: linhas.length,
      divergentes: div.length,
      faltam: linhas.reduce((s, l) => s + (l.qtd_pedido - l.qtd_separada), 0),
      pedido: linhas.reduce((s, l) => s + l.qtd_pedido, 0),
      separado: linhas.reduce((s, l) => s + l.qtd_separada, 0),
    };
  }, [linhas]);

  const termo = busca.trim().toLowerCase();
  const visiveis = linhas.filter(
    (l) =>
      (!soDivergentes || l.lojas_divergentes > 0) &&
      (!termo || l.gtin.includes(termo) || l.produto.toLowerCase().includes(termo)),
  );

  async function exportar() {
    if (!escolhida) return;
    const { data } = await buscarTudo<ItemLoja & { gtin: string; produto: string }>((de, ate) =>
      supabase
        .from("v_itens")
        .select("id,gtin,produto,loja_nome,loja_numero,pedido_nome,operador_nome,qtd_pedido,qtd_separada")
        .eq("remessa_id", escolhida.id)
        .order("gtin")
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .range(de, ate),
    );
    const div = (data ?? []).filter((i) => i.qtd_separada !== i.qtd_pedido);
    baixarCsv(`conferencia-${escolhida.codigo}.csv`, [
      ["GTIN", "Produto", "Loja", "Pedido", "Operador", "Pedido (un.)", "Separado (un.)", "Diferença"],
      ...div.map((i) => [
        i.gtin,
        i.produto,
        nomeLoja(i.loja_nome, i.loja_numero),
        i.pedido_nome,
        i.operador_nome,
        i.qtd_pedido,
        i.qtd_separada,
        i.qtd_separada - i.qtd_pedido,
      ]),
    ]);
  }

  async function concluir() {
    if (!escolhida) return;
    const ok = await confirmar({
      titulo: `Concluir a remessa ${escolhida.codigo}?`,
      mensagem:
        resumo.faltam > 0 ? (
          <>
            Ainda faltam <strong>{fmtNum(resumo.faltam)}</strong> unidades em {resumo.divergentes} produtos. Ao concluir, a remessa sai
            da tela dos operadores.
          </>
        ) : (
          "Tudo conferido. A remessa sai da tela dos operadores."
        ),
      confirmar: "Concluir remessa",
      perigo: resumo.faltam > 0,
    });
    if (!ok) return;
    setOcupado(true);
    await alterarStatus(escolhida.id, "concluida");
    setOcupado(false);
  }

  return (
    <>
      {dialogo}
      <Titulo
        titulo="Conferência"
        descricao={
          aba === "separacao"
            ? "Produtos em que o separado não bate com o pedido, loja por loja."
            : "Rebipagem das caixas de cada loja, confrontada com o que foi separado."
        }
        acoes={
          escolhida && (
            <>
              <Link to={`/conferir?remessa=${escolhida.id}`} className={classesBotao("azul")}>
                <ScanBarcode className="size-4" aria-hidden /> Conferir (bipar)
              </Link>
              {aba === "separacao" && (
                <Botao variante="secundario" icone={<Download className="size-4" />} onClick={exportar}>
                  Exportar divergências
                </Botao>
              )}
              {escolhida.status !== "concluida" && (
                <Botao variante="sucesso" icone={<CheckCheck className="size-4" />} onClick={concluir} carregando={ocupado}>
                  Concluir remessa
                </Botao>
              )}
            </>
          )
        }
      />

      {carregando ? (
        <Carregando />
      ) : remessas.length === 0 ? (
        <Cartao>
          <Vazio icone={<ClipboardCheck className="size-8" />} titulo="Nenhuma remessa para conferir" />
        </Cartao>
      ) : (
        <>
          <Cartao className="mb-4 flex flex-wrap items-end gap-3 p-4">
            <Selecao
              rotulo="Remessa"
              className="min-w-56 flex-1"
              value={escolhida?.id ?? ""}
              onChange={(e) => escolher(Number(e.target.value))}
            >
              {remessas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.codigo} · {r.status}
                </option>
              ))}
            </Selecao>
            {escolhida && (
              <span className="flex h-11 items-center gap-2">
                <SeloStatus status={escolhida.status} />
                <Link to={`/remessas/${escolhida.id}`} className="text-sm font-medium text-azul-escuro hover:underline">
                  Ver remessa
                </Link>
              </span>
            )}
          </Cartao>

          <div className="mb-4 flex gap-1 rounded-xl bg-white p-1 ring-1 ring-borda sm:w-fit" role="tablist" aria-label="Tipo de conferência">
            {(
              [
                ["separacao", "Separação × pedido"],
                ["fisica", "Conferência física"],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={aba === k}
                onClick={() => trocarAba(k)}
                className={cx(
                  "h-10 flex-1 rounded-lg px-4 text-sm font-medium transition-colors sm:flex-none",
                  aba === k ? "bg-navy text-white" : "text-navy hover:bg-azul-claro/60",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {aba === "fisica" && escolhida ? (
            <ConferenciaFisica remessa={escolhida} />
          ) : (
          <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cartao className="p-4">
              <p className="text-xs text-suave">Produtos</p>
              <p className="tabular text-2xl font-semibold">{fmtNum(resumo.produtos)}</p>
            </Cartao>
            <Cartao className="p-4">
              <p className="text-xs text-suave">Com divergência</p>
              <p className={cx("tabular text-2xl font-semibold", resumo.divergentes > 0 && "text-erro")}>{fmtNum(resumo.divergentes)}</p>
            </Cartao>
            <Cartao className="p-4">
              <p className="text-xs text-suave">Unidades faltando</p>
              <p className="tabular text-2xl font-semibold">{fmtNum(resumo.faltam)}</p>
            </Cartao>
            <Cartao className="p-4">
              <p className="text-xs text-suave">Separado</p>
              <p className="tabular text-2xl font-semibold">
                {fmtNum(resumo.separado)}
                <span className="text-base font-normal text-suave">/{fmtNum(resumo.pedido)}</span>
              </p>
              <Barra parte={resumo.separado} total={resumo.pedido} className="mt-2" />
            </Cartao>
          </div>

          <Cartao className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-borda p-4">
              <div className="relative min-w-60 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-suave" aria-hidden />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por GTIN ou produto"
                  aria-label="Buscar por GTIN ou produto"
                  className="h-10 w-full rounded-xl border border-borda pr-3 pl-9 text-sm focus:border-azul focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-azul"
                  checked={soDivergentes}
                  onChange={(e) => setSoDivergentes(e.target.checked)}
                />
                Só divergentes
              </label>
            </div>
            {!conf.dados ? (
              <Carregando />
            ) : visiveis.length === 0 ? (
              <Vazio icone={<CheckCheck className="size-8" />} titulo={soDivergentes ? "Nenhuma divergência" : "Nada encontrado"}>
                {soDivergentes && linhas.length > 0 && "Tudo o que foi pedido foi separado."}
              </Vazio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                    <tr>
                      <th className="px-5 py-3">Produto</th>
                      <th className="px-3 py-3 text-right">Lojas c/ divergência</th>
                      <th className="px-3 py-3 text-right">Separado</th>
                      <th className="w-24 px-5 py-3 text-right">Falta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borda">
                    {visiveis.map((l) => {
                      const falta = l.qtd_pedido - l.qtd_separada;
                      return (
                        <Fragment key={l.gtin}>
                          <tr className="cursor-pointer hover:bg-fundo/60" onClick={() => setAberto(aberto === l.gtin ? null : l.gtin)}>
                            <td className="px-5 py-3">
                              <button
                                type="button"
                                className="flex items-start gap-2 text-left"
                                aria-expanded={aberto === l.gtin}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAberto(aberto === l.gtin ? null : l.gtin);
                                }}
                              >
                                <ChevronDown
                                  className={cx("mt-0.5 size-4 shrink-0 text-suave transition-transform", aberto === l.gtin && "rotate-180")}
                                  aria-hidden
                                />
                                <span>
                                  <span className="font-medium">{l.produto}</span>
                                  <span className="tabular block text-xs text-suave">{l.gtin}</span>
                                </span>
                              </button>
                            </td>
                            <td className="tabular px-3 py-3 text-right">
                              {l.lojas_divergentes}/{l.lojas}
                            </td>
                            <td className="tabular px-3 py-3 text-right">
                              {fmtNum(l.qtd_separada)}/{fmtNum(l.qtd_pedido)}
                            </td>
                            <td className={cx("tabular px-5 py-3 text-right font-semibold", falta > 0 ? "text-erro" : "text-ciano-escuro")}>
                              {falta > 0 ? fmtNum(falta) : "ok"}
                            </td>
                          </tr>
                          {aberto === l.gtin && escolhida && (
                            <tr className="bg-fundo/50">
                              <td colSpan={4} className="p-0">
                                <LojasDoGtin remessa={escolhida.id} gtin={l.gtin} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
