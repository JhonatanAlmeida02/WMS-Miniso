import { useState } from "react";
import { Link } from "react-router";
import { PackagePlus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtData, fmtNum, fmtPct } from "../lib/formato";
import type { Remessa, StatusRemessa } from "../lib/tipos";
import { AvisoErro, Barra, Cartao, Carregando, SeloStatus, Titulo, Vazio, classesBotao, cx } from "../components/ui";

const FILTROS: { valor: StatusRemessa | "todas"; texto: string }[] = [
  { valor: "ativa", texto: "Ativas" },
  { valor: "pendente", texto: "Pendentes" },
  { valor: "concluida", texto: "Concluídas" },
  { valor: "todas", texto: "Todas" },
];

export default function Remessas() {
  const [filtro, setFiltro] = useState<StatusRemessa | "todas">("todas");
  const { dados, erro, carregando } = useConsulta<Remessa[]>(
    () => {
      let q = supabase.from("v_remessas").select("*").order("criado_em", { ascending: false }).limit(200);
      if (filtro !== "todas") q = q.eq("status", filtro);
      return q;
    },
    [filtro],
    { tabelas: ["remessas", "bips"], atraso: 3000 },
  );

  return (
    <>
      <Titulo
        titulo="Remessas"
        descricao="Importe a planilha, ative para os operadores e conclua depois da conferência."
        acoes={
          <Link to="/remessas/nova" className={classesBotao()}>
            <PackagePlus className="size-5" aria-hidden /> Nova remessa
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por status">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="tab"
            aria-selected={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
            className={cx(
              "h-9 rounded-full px-4 text-sm font-medium transition-colors",
              filtro === f.valor ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-borda hover:bg-azul-claro/50",
            )}
          >
            {f.texto}
          </button>
        ))}
      </div>

      {erro && <AvisoErro>{erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        {carregando && !dados ? (
          <Carregando />
        ) : (dados ?? []).length === 0 ? (
          <Vazio icone={<PackagePlus className="size-8" />} titulo="Nenhuma remessa aqui">
            Use “Nova remessa” para importar a planilha do Excel.
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Remessa</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Chegada</th>
                  <th className="px-3 py-3 text-right">Lojas</th>
                  <th className="px-3 py-3 text-right">Pedidos</th>
                  <th className="px-3 py-3 text-right">Unidades</th>
                  <th className="w-48 px-5 py-3">Separado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {(dados ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-fundo/60">
                    <td className="px-5 py-3">
                      <Link to={`/remessas/${r.id}`} className="font-semibold text-navy hover:text-azul-escuro hover:underline">
                        {r.codigo}
                      </Link>
                      <p className="text-xs text-suave">Importada {fmtData(r.criado_em)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <SeloStatus status={r.status} />
                    </td>
                    <td className="tabular px-3 py-3">{fmtData(r.data_chegada)}</td>
                    <td className="tabular px-3 py-3 text-right">{fmtNum(r.lojas)}</td>
                    <td className="tabular px-3 py-3 text-right">
                      {fmtNum(r.pedidos)}
                      {r.pedidos_sem_operador > 0 && r.status !== "concluida" && (
                        <span className="block text-xs text-[#7a5200]">{r.pedidos_sem_operador} sem operador</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-3 text-right">{fmtNum(r.qtd_pedido)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Barra parte={r.qtd_separada} total={r.qtd_pedido} />
                        <span className="tabular w-14 text-right font-medium">{fmtPct(r.qtd_separada, r.qtd_pedido)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}
