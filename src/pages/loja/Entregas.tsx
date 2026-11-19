import { useState } from "react";
import { useNavigate } from "react-router";
import { ScanBarcode, Truck } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { useConexao } from "../../lib/operacao";
import { fmtDataHora } from "../../lib/formato";
import type { Expedicao, StatusRecebimento } from "../../lib/tipos";
import { AvisoErro, Cartao, Carregando, Titulo, Vazio, cx } from "../../components/ui";
import { EstadoAtualizacao, ROTULO_RECEBIMENTO, SeloRecebimento, podeConferir } from "../../components/loja/comum";
import { ModalConfronto } from "./PedidoLoja";
import { useAtualizacao } from "./PainelLoja";

const ABAS: [StatusRecebimento | "pendentes" | "todas", string][] = [
  ["pendentes", "A conferir"],
  ["recebido_com_divergencia", "Com divergência"],
  ["recebido_conferido", "Conferidas"],
  ["todas", "Todas"],
];

/** Entregas expedidas para a loja: identificar e conferir o que chegou. */
export default function Entregas() {
  const { perfil } = useAuth();
  const online = useConexao();
  const navegar = useNavigate();
  const [aba, setAba] = useState<(typeof ABAS)[number][0]>("pendentes");
  const [confronto, setConfronto] = useState<Expedicao | null>(null);
  const entregas = useConsulta<Expedicao[]>(
    () => supabase.from("v_expedicoes").select("*").eq("loja_id", perfil?.loja_id ?? -1).order("expedida_em", { ascending: false }).limit(300),
    [perfil?.loja_id],
    { tabelas: ["expedicoes", "recebimentos_loja", "divergencias"] },
  );
  const quando = useAtualizacao(entregas.dados, entregas.recarregar);
  const todas = entregas.dados ?? [];
  const lista = todas.filter((e) =>
    aba === "todas" ? true : aba === "pendentes" ? podeConferir(e) : e.recebimento_status === aba,
  );
  const contar = (k: (typeof ABAS)[number][0]) =>
    k === "todas" ? todas.length : k === "pendentes" ? todas.filter(podeConferir).length : todas.filter((e) => e.recebimento_status === k).length;

  return (
    <>
      <Titulo
        titulo="Entregas"
        descricao="O que a PRODIGY expediu para a loja. Toque numa entrega para conferir o que chegou."
        acoes={<EstadoAtualizacao quando={quando} online={online} aoAtualizar={entregas.recarregar} />}
      />
      {entregas.erro && <AvisoErro>{entregas.erro}</AvisoErro>}

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-borda sm:w-fit" role="tablist" aria-label="Situação das entregas">
        {ABAS.map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            onClick={() => setAba(k)}
            className={cx(
              "h-10 flex-1 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none",
              aba === k ? "bg-navy text-white" : "text-navy hover:bg-azul-claro/60",
            )}
          >
            {t} <span className="tabular opacity-70">({contar(k)})</span>
          </button>
        ))}
      </div>

      {entregas.carregando && !entregas.dados ? (
        <Carregando />
      ) : lista.length === 0 ? (
        <Cartao>
          <Vazio icone={<Truck className="size-8" />} titulo={aba === "pendentes" ? "Nenhuma entrega para conferir" : "Nenhuma entrega aqui"}>
            Só aparecem entregas com saída registrada pela PRODIGY.
          </Vazio>
        </Cartao>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((e) => {
            const conferir = podeConferir(e);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => (conferir ? navegar(`/loja/conferir/${e.recebimento_id}`) : setConfronto(e))}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 transition-colors hover:ring-azul",
                    e.recebimento_status === "recebido_com_divergencia" ? "ring-erro/40" : e.recebimento_status === "recebido_conferido" ? "ring-ciano/60" : "ring-borda",
                  )}
                  aria-label={`${conferir ? "Conferir" : "Ver"} entrega ${e.numero} do pedido ${e.pedido_nome}: ${ROTULO_RECEBIMENTO[e.recebimento_status].texto}`}
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-[28%] bg-azul-claro text-xl font-semibold text-azul-escuro">
                    {conferir ? <ScanBarcode className="size-6" aria-hidden /> : e.numero}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      Pedido {e.pedido_nome} · entrega {e.numero}
                    </span>
                    <span className="tabular block text-xs text-suave">
                      Remessa {e.remessa_codigo} · {e.volumes} vol. · {e.produtos} {e.produtos === 1 ? "produto" : "produtos"} · {fmtDataHora(e.expedida_em)}
                    </span>
                    <span className="mt-1 block">
                      <SeloRecebimento status={e.recebimento_status} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ModalConfronto entrega={confronto} aoFechar={() => setConfronto(null)} visao="loja" />
    </>
  );
}
