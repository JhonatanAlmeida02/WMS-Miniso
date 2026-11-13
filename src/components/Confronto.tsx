import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { fmtNum } from "../lib/formato";
import type { LinhaConfronto, SituacaoConferencia } from "../lib/tipos";
import { Selo, Vazio, cx } from "./ui";

export const ROTULO_SITUACAO: Record<SituacaoConferencia, { texto: string; classe: string }> = {
  ok: { texto: "OK", classe: "bg-ciano-claro text-ciano-escuro" },
  falta: { texto: "Falta", classe: "bg-erro-claro text-erro" },
  sobra: { texto: "Sobra", classe: "bg-amarelo-claro text-[#7a5200]" },
  fora_do_pedido: { texto: "Não é desta loja", classe: "bg-erro text-white" },
};

export function contarSituacoes(linhas: LinhaConfronto[]) {
  const c = { ok: 0, falta: 0, sobra: 0, fora_do_pedido: 0 } as Record<SituacaoConferencia, number>;
  for (const l of linhas) c[l.situacao] += 1;
  return c;
}

/** Confronto conferido x separado (x pedido), com as divergências primeiro. */
export function Confronto({ linhas }: { linhas: LinhaConfronto[] }) {
  const [todos, setTodos] = useState(false);
  const c = contarSituacoes(linhas);
  const divergentes = linhas.filter((l) => l.situacao !== "ok");
  const visiveis = todos ? linhas : divergentes;
  const separado = linhas.reduce((s, l) => s + l.qtd_separada, 0);
  const conferido = linhas.filter((l) => l.situacao !== "fora_do_pedido").reduce((s, l) => s + l.qtd_conferida, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ok", "Produtos OK"],
            ["falta", "Com falta"],
            ["sobra", "Com sobra"],
            ["fora_do_pedido", "De outra loja"],
          ] as [SituacaoConferencia, string][]
        ).map(([k, r]) => (
          <div key={k} className={cx("rounded-xl px-3 py-2", c[k] > 0 && k !== "ok" ? ROTULO_SITUACAO[k].classe : "bg-fundo")}>
            <p className="text-xs opacity-80">{r}</p>
            <p className="tabular text-2xl font-semibold">{fmtNum(c[k])}</p>
          </div>
        ))}
      </div>
      <p className="tabular text-sm text-suave">
        Separado <strong className="text-navy">{fmtNum(separado)}</strong> un. · Conferido{" "}
        <strong className="text-navy">{fmtNum(conferido)}</strong> un.
        {separado !== conferido && (
          <strong className={conferido < separado ? "text-erro" : "text-[#7a5200]"}>
            {" "}
            · diferença {conferido - separado > 0 ? "+" : ""}
            {fmtNum(conferido - separado)}
          </strong>
        )}
      </p>

      {visiveis.length === 0 ? (
        <Vazio icone={<CheckCheck className="size-8" />} titulo="Tudo bate">
          O que foi conferido é exatamente o que foi separado.
        </Vazio>
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-xl ring-1 ring-borda">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
              <tr>
                <th className="px-3 py-2">Produto</th>
                <th className="px-2 py-2 text-right">Pedido</th>
                <th className="px-2 py-2 text-right">Separado</th>
                <th className="px-2 py-2 text-right">Conferido</th>
                <th className="px-3 py-2 text-right">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {visiveis.map((l) => {
                const dif = l.qtd_conferida - l.qtd_separada;
                return (
                  <tr key={l.gtin}>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2">{l.produto}</span>
                      <span className="tabular block text-xs text-suave">{l.gtin}</span>
                    </td>
                    <td className="tabular px-2 py-2 text-right text-suave">{l.qtd_pedido}</td>
                    <td className="tabular px-2 py-2 text-right">{l.qtd_separada}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold">{l.qtd_conferida}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Selo className={ROTULO_SITUACAO[l.situacao].classe}>
                        {ROTULO_SITUACAO[l.situacao].texto}
                        {l.situacao !== "ok" && l.situacao !== "fora_do_pedido" && ` ${dif > 0 ? "+" : ""}${dif}`}
                      </Selo>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {divergentes.length !== linhas.length && (
        <label className="flex items-center gap-2 text-sm text-suave">
          <input type="checkbox" className="size-4 accent-azul" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Mostrar também os {fmtNum(linhas.length - divergentes.length)} produtos OK
        </label>
      )}
    </div>
  );
}
