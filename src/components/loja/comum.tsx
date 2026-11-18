import { useState, type ReactNode } from "react";
import { CheckCheck, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { fmtNum } from "../../lib/formato";
import type {
  Expedicao,
  LinhaRecebimento,
  PedidoLoja,
  SituacaoRecebimento,
  StatusDivergencia,
  StatusRecebimento,
  TipoDivergencia,
} from "../../lib/tipos";
import { Cartao, Selo, Vazio, cx } from "../ui";

/** Cartão de número, no mesmo padrão do Painel do supervisor. */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  destaque,
  children,
}: {
  rotulo: string;
  valor: string;
  detalhe?: ReactNode;
  destaque?: string;
  children?: ReactNode;
}) {
  return (
    <Cartao className="relative overflow-hidden p-5">
      <span className={cx("absolute inset-y-0 left-0 w-1", destaque ?? "bg-azul")} aria-hidden />
      <p className="text-sm text-suave">{rotulo}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-suave">{detalhe}</p>}
      {children}
    </Cartao>
  );
}

/** "Atualizado às 10:42 · conectado" + botão de atualizar. */
export function EstadoAtualizacao({ quando, online, aoAtualizar }: { quando: Date | null; online: boolean; aoAtualizar: () => void }) {
  return (
    <div className="flex items-center gap-3 text-xs text-suave">
      <span className={cx("inline-flex items-center gap-1.5 font-medium", online ? "text-ciano-escuro" : "text-erro")}>
        {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
        {online ? "Conectado" : "Sem internet"}
      </span>
      {quando && (
        <span className="tabular">Atualizado às {quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      )}
      <button
        type="button"
        onClick={aoAtualizar}
        className="rounded-lg p-1.5 text-navy hover:bg-navy/5"
        aria-label="Atualizar agora"
        title="Atualizar agora"
      >
        <RefreshCw className="size-4" />
      </button>
    </div>
  );
}

export const ROTULO_RECEBIMENTO: Record<StatusRecebimento, { texto: string; classe: string }> = {
  aguardando: { texto: "Aguardando conferência", classe: "bg-amarelo-claro text-[#7a5200]" },
  em_conferencia: { texto: "Em conferência", classe: "bg-azul-claro text-azul-escuro" },
  recebido_conferido: { texto: "Recebido conferido", classe: "bg-ciano-claro text-ciano-escuro" },
  recebido_com_divergencia: { texto: "Recebido com divergência", classe: "bg-erro-claro text-erro" },
};

export function SeloRecebimento({ status }: { status: StatusRecebimento }) {
  const r = ROTULO_RECEBIMENTO[status];
  return <Selo className={r.classe}>{r.texto}</Selo>;
}

export const ROTULO_TIPO: Record<TipoDivergencia, string> = {
  falta: "Falta",
  sobra: "Sobra",
  avaria: "Avaria",
  inesperado: "Não esperado",
};

export const ROTULO_STATUS_DIVERGENCIA: Record<StatusDivergencia, { texto: string; classe: string }> = {
  aberta: { texto: "Aberta", classe: "bg-erro-claro text-erro" },
  em_analise: { texto: "Em análise", classe: "bg-amarelo-claro text-[#7a5200]" },
  resolvida: { texto: "Resolvida", classe: "bg-ciano-claro text-ciano-escuro" },
};

/** Situação de um pedido da loja, da separação ao recebimento. */
export function situacaoPedido(p: PedidoLoja): { chave: string; texto: string; classe: string } {
  if (p.remessa_status === "pendente") return { chave: "aguardando", texto: "Aguardando início", classe: "bg-navy/8 text-suave" };
  if (p.entregas_com_divergencia > 0) return { chave: "divergencia", texto: "Recebido com divergência", classe: "bg-erro-claro text-erro" };
  if (p.entregas_em_conferencia > 0) return { chave: "conferindo", texto: "Em conferência na loja", classe: "bg-azul-claro text-azul-escuro" };
  if (p.entregas_aguardando > 0) return { chave: "expedido", texto: "Expedido · aguardando conferência", classe: "bg-amarelo-claro text-[#7a5200]" };
  if (p.qtd_expedida > 0 && p.qtd_expedida >= p.qtd_pedido) return { chave: "recebido", texto: "Recebido", classe: "bg-ciano-claro text-ciano-escuro" };
  if (p.qtd_expedida > 0) return { chave: "parcial", texto: "Entrega parcial recebida", classe: "bg-ciano-claro text-ciano-escuro" };
  if (p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido) return { chave: "separado", texto: "Separado no CD", classe: "bg-azul-claro text-azul-escuro" };
  if (p.qtd_separada > 0) return { chave: "separando", texto: "Em separação", classe: "bg-azul-claro text-azul-escuro" };
  return { chave: "aguardando", texto: "Aguardando separação", classe: "bg-navy/8 text-suave" };
}

export const FILTROS_SITUACAO: [string, string][] = [
  ["", "Todas as situações"],
  ["aguardando", "Aguardando"],
  ["separando", "Em separação"],
  ["separado", "Separado no CD"],
  ["expedido", "Expedido · aguardando conferência"],
  ["conferindo", "Em conferência na loja"],
  ["parcial", "Entrega parcial recebida"],
  ["recebido", "Recebido"],
  ["divergencia", "Com divergência"],
];

/** "45,0%" ou "Sem itens" quando não há o que separar. */
export function pctOuSemItens(parte: number, total: number) {
  if (!total) return "Sem itens";
  return `${Math.min(100, (parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

export const podeConferir = (e: Pick<Expedicao, "recebimento_status">) =>
  e.recebimento_status === "aguardando" || e.recebimento_status === "em_conferencia";

export const ROTULO_SITUACAO_RECEBIMENTO: Record<SituacaoRecebimento, { texto: string; classe: string }> = {
  ok: { texto: "OK", classe: "bg-ciano-claro text-ciano-escuro" },
  falta: { texto: "Falta", classe: "bg-erro-claro text-erro" },
  sobra: { texto: "Sobra", classe: "bg-amarelo-claro text-[#7a5200]" },
  avaria: { texto: "Avaria", classe: "bg-amarelo-claro text-[#7a5200]" },
  inesperado: { texto: "Não veio nesta entrega", classe: "bg-erro text-white" },
};

export function contarSituacoesRecebimento(linhas: LinhaRecebimento[]) {
  const c = { ok: 0, falta: 0, sobra: 0, avaria: 0, inesperado: 0 } as Record<SituacaoRecebimento, number>;
  for (const l of linhas) c[l.situacao] += 1;
  return c;
}

/** Confronto expedido × recebido (íntegro + avariado), no padrão do Confronto do CD. */
export function ConfrontoRecebimento({ linhas }: { linhas: LinhaRecebimento[] }) {
  const [todos, setTodos] = useState(false);
  const c = contarSituacoesRecebimento(linhas);
  const divergentes = linhas.filter((l) => l.situacao !== "ok");
  const visiveis = todos ? linhas : divergentes;
  const expedido = linhas.reduce((s, l) => s + l.qtd_expedida, 0);
  const doManifesto = linhas.filter((l) => l.situacao !== "inesperado");
  const recebido = doManifesto.reduce((s, l) => s + l.qtd_recebida, 0);
  const avariado = linhas.reduce((s, l) => s + l.qtd_avariada, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["ok", "Produtos OK"],
            ["falta", "Com falta"],
            ["sobra", "Com sobra"],
            ["avaria", "Com avaria"],
            ["inesperado", "Não esperados"],
          ] as [SituacaoRecebimento, string][]
        ).map(([k, r]) => (
          <div key={k} className={cx("rounded-xl px-3 py-2", c[k] > 0 && k !== "ok" ? ROTULO_SITUACAO_RECEBIMENTO[k].classe : "bg-fundo")}>
            <p className="text-xs opacity-80">{r}</p>
            <p className="tabular text-2xl font-semibold">{fmtNum(c[k])}</p>
          </div>
        ))}
      </div>
      <p className="tabular text-sm text-suave">
        Expedido <strong className="text-navy">{fmtNum(expedido)}</strong> un. · Recebido{" "}
        <strong className="text-navy">{fmtNum(recebido)}</strong> un.
        {avariado > 0 && (
          <>
            {" "}
            (<strong className="text-[#7a5200]">{fmtNum(avariado)} avariadas</strong>)
          </>
        )}
        {expedido !== recebido && (
          <strong className={recebido < expedido ? "text-erro" : "text-[#7a5200]"}>
            {" "}
            · diferença {recebido - expedido > 0 ? "+" : ""}
            {fmtNum(recebido - expedido)}
          </strong>
        )}
      </p>

      {visiveis.length === 0 ? (
        <Vazio icone={<CheckCheck className="size-8" />} titulo="Tudo bate">
          O que chegou é exatamente o que saiu do CD, sem avarias.
        </Vazio>
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-xl ring-1 ring-borda">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
              <tr>
                <th className="px-3 py-2">Produto</th>
                <th className="px-2 py-2 text-right">Pedido</th>
                <th className="px-2 py-2 text-right">Expedido</th>
                <th className="px-2 py-2 text-right">Recebido</th>
                <th className="px-2 py-2 text-right">Avariado</th>
                <th className="px-3 py-2 text-right">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {visiveis.map((l) => {
                const dif = l.qtd_recebida - l.qtd_expedida;
                return (
                  <tr key={l.gtin}>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2">{l.produto}</span>
                      <span className="tabular block text-xs text-suave">{l.gtin}</span>
                    </td>
                    <td className="tabular px-2 py-2 text-right text-suave">{l.qtd_pedido || "—"}</td>
                    <td className="tabular px-2 py-2 text-right">{l.qtd_expedida}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold">{l.qtd_recebida}</td>
                    <td className={cx("tabular px-2 py-2 text-right", l.qtd_avariada > 0 && "font-semibold text-[#7a5200]")}>
                      {l.qtd_avariada || "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Selo className={ROTULO_SITUACAO_RECEBIMENTO[l.situacao].classe}>
                        {ROTULO_SITUACAO_RECEBIMENTO[l.situacao].texto}
                        {(l.situacao === "falta" || l.situacao === "sobra") && ` ${dif > 0 ? "+" : ""}${dif}`}
                        {l.situacao === "avaria" && ` ${l.qtd_avariada}`}
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
