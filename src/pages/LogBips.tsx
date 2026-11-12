import { useMemo, useState } from "react";
import { Download, History, RotateCcw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { useRemessaEscolhida } from "../lib/useRemessaEscolhida";
import { baixarCsv, buscarTudo } from "../lib/buscarTudo";
import { fmtDataHora, fmtNum, nomeLoja } from "../lib/formato";
import type { Bip, Loja, Perfil, TipoBip } from "../lib/tipos";
import { Botao, Cartao, Carregando, Selecao, Selo, Titulo, Vazio } from "../components/ui";

const POR_PAGINA = 100;

export default function LogBips() {
  const { lista: remessas, escolhida, escolher, carregando } = useRemessaEscolhida(true);
  const [gtin, setGtin] = useState("");
  const [tipo, setTipo] = useState<TipoBip | "">("");
  const [loja, setLoja] = useState("");
  const [operador, setOperador] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);

  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*").order("numero", { nullsFirst: false }).order("nome"), []);
  const usuarios = useConsulta<Perfil[]>(() => supabase.from("perfis").select("*").order("nome"), []);

  const filtros = useMemo(() => ({ gtin: gtin.trim(), tipo, loja, operador }), [gtin, tipo, loja, operador]);

  function consulta() {
    let q = supabase.from("v_bips").select("*").eq("remessa_id", escolhida?.id ?? -1);
    if (filtros.gtin) q = q.like("gtin", `${filtros.gtin}%`);
    if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
    if (filtros.loja) q = q.eq("loja_id", Number(filtros.loja));
    if (filtros.operador) q = q.eq("operador_id", filtros.operador);
    return q.order("criado_em", { ascending: false });
  }

  const bips = useConsulta<Bip[]>(() => consulta().limit(limite), [escolhida?.id, filtros, limite], {
    tabelas: ["bips"],
    ativo: !!escolhida,
  });

  const temFiltro = filtros.gtin || filtros.tipo || filtros.loja || filtros.operador;
  const lista = bips.dados ?? [];
  const saldo = lista.reduce((s, b) => s + b.qtd, 0);

  async function exportar() {
    const { data } = await buscarTudo<Bip>((de, ate) => consulta().range(de, ate));
    baixarCsv(`bips-${escolhida?.codigo ?? "remessa"}.csv`, [
      ["Data/hora", "Tipo", "Qtd", "GTIN", "Produto", "Loja", "Pedido", "Operador"],
      ...(data ?? []).map((b) => [
        new Date(b.criado_em).toLocaleString("pt-BR"),
        b.tipo,
        b.qtd,
        b.gtin,
        b.produto,
        nomeLoja(b.loja_nome, b.loja_numero),
        b.pedido_nome,
        b.operador_nome,
      ]),
    ]);
  }

  return (
    <>
      <Titulo
        titulo="Log de bips"
        descricao="Cada bipagem e cada ajuste, com quem fez e quando."
        acoes={
          <Botao variante="secundario" icone={<Download className="size-4" />} onClick={exportar} disabled={!escolhida}>
            Exportar CSV
          </Botao>
        }
      />
      {carregando ? (
        <Carregando />
      ) : (
        <>
          <Cartao className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_0.8fr_1fr_1fr_auto] lg:items-end">
            <Selecao rotulo="Remessa" value={escolhida?.id ?? ""} onChange={(e) => escolher(Number(e.target.value))}>
              {remessas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.codigo} · {r.status}
                </option>
              ))}
            </Selecao>
            <div>
              <label htmlFor="f-gtin" className="mb-1.5 block text-sm font-medium">
                GTIN começa com
              </label>
              <input
                id="f-gtin"
                value={gtin}
                inputMode="numeric"
                onChange={(e) => {
                  setGtin(e.target.value);
                  setLimite(POR_PAGINA);
                }}
                className="h-11 w-full rounded-xl border border-borda px-3 text-[15px] focus:border-azul focus:outline-none"
              />
            </div>
            <Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoBip | "")}>
              <option value="">Todos</option>
              <option value="entrada">Entrada</option>
              <option value="ajuste">Ajuste</option>
            </Selecao>
            <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)}>
              <option value="">Todas</option>
              {(lojas.dados ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {nomeLoja(l.nome, l.numero)}
                </option>
              ))}
            </Selecao>
            <Selecao rotulo="Operador" value={operador} onChange={(e) => setOperador(e.target.value)}>
              <option value="">Todos</option>
              {(usuarios.dados ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </Selecao>
            <Botao
              variante="fantasma"
              icone={<RotateCcw className="size-4" />}
              disabled={!temFiltro}
              onClick={() => {
                setGtin("");
                setTipo("");
                setLoja("");
                setOperador("");
              }}
            >
              Limpar
            </Botao>
          </Cartao>

          <Cartao className="overflow-hidden">
            {!bips.dados ? (
              <Carregando />
            ) : lista.length === 0 ? (
              <Vazio icone={<History className="size-8" />} titulo="Nenhum bip encontrado" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                      <tr>
                        <th className="px-5 py-3">Quando</th>
                        <th className="px-3 py-3">Tipo</th>
                        <th className="px-3 py-3 text-right">Qtd</th>
                        <th className="px-3 py-3">Produto</th>
                        <th className="px-3 py-3">Loja / pedido</th>
                        <th className="px-5 py-3">Operador</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borda">
                      {lista.map((b) => (
                        <tr key={b.id}>
                          <td className="tabular px-5 py-2.5 whitespace-nowrap text-suave">{fmtDataHora(b.criado_em)}</td>
                          <td className="px-3 py-2.5">
                            {b.tipo === "ajuste" ? (
                              <Selo className="bg-amarelo-claro text-[#7a5200]">Ajuste</Selo>
                            ) : (
                              <Selo className="bg-ciano-claro text-ciano-escuro">Entrada</Selo>
                            )}
                          </td>
                          <td className="tabular px-3 py-2.5 text-right font-semibold">
                            {b.qtd > 0 ? "+" : ""}
                            {b.qtd}
                          </td>
                          <td className="px-3 py-2.5">
                            {b.produto}
                            <span className="tabular block text-xs text-suave">{b.gtin}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            {nomeLoja(b.loja_nome, b.loja_numero)}
                            <span className="block text-xs text-suave">Pedido {b.pedido_nome}</span>
                          </td>
                          <td className="px-5 py-2.5">{b.operador_nome ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda px-5 py-3 text-sm text-suave">
                  <span>
                    Mostrando {fmtNum(lista.length)} bips · saldo {saldo > 0 ? "+" : ""}
                    {fmtNum(saldo)} un.
                  </span>
                  {lista.length >= limite && (
                    <Botao variante="secundario" tamanho="sm" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                      Carregar mais
                    </Botao>
                  )}
                </div>
              </>
            )}
          </Cartao>
        </>
      )}
    </>
  );
}
