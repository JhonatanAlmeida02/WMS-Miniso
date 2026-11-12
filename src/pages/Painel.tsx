import { Link } from "react-router";
import { ArrowRight, PackagePlus, Radio, ScanBarcode, Store, UserX } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtDataHora, fmtNum, fmtPct, nomeLoja, situacaoOnline, tempoRelativo } from "../lib/formato";
import type { Bip, PedidoResumo, Perfil, Remessa } from "../lib/tipos";
import { Barra, Cartao, Carregando, Titulo, Vazio, classesBotao, cx } from "../components/ui";

function Indicador({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: string; detalhe?: string; destaque?: string }) {
  return (
    <Cartao className="relative overflow-hidden p-5">
      <span className={cx("absolute inset-y-0 left-0 w-1", destaque ?? "bg-azul")} aria-hidden />
      <p className="text-sm text-suave">{rotulo}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-suave">{detalhe}</p>}
    </Cartao>
  );
}

const PONTO = {
  online: "bg-ciano",
  inativo: "bg-amarelo",
  offline: "bg-navy/20",
};

export default function Painel() {
  const remessas = useConsulta<Remessa[]>(
    () => supabase.from("v_remessas").select("*").eq("status", "ativa").order("ativada_em"),
    [],
    { tabelas: ["remessas", "itens_pedido", "pedidos"] },
  );
  const pedidos = useConsulta<PedidoResumo[]>(
    () => supabase.from("v_pedidos").select("*").eq("remessa_status", "ativa"),
    [],
    { tabelas: ["itens_pedido", "pedidos", "remessas"] },
  );
  const usuarios = useConsulta<Perfil[]>(
    () => supabase.from("perfis").select("*").eq("ativo", true).order("nome"),
    [],
  );
  const bips = useConsulta<Bip[]>(
    () => supabase.from("v_bips").select("*").order("criado_em", { ascending: false }).limit(12),
    [],
    { tabelas: ["bips"] },
  );

  if (remessas.carregando && !remessas.dados) return <Carregando />;

  const ativas = remessas.dados ?? [];
  const peds = pedidos.dados ?? [];
  const totalPedido = ativas.reduce((s, r) => s + r.qtd_pedido, 0);
  const totalSeparado = ativas.reduce((s, r) => s + r.qtd_separada, 0);
  const semOperador = peds.filter((p) => !p.operador_id).length;
  const completos = peds.filter((p) => p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido).length;
  const equipe = usuarios.dados ?? [];
  const online = equipe.filter((u) => situacaoOnline(u.ultima_atividade) === "online").length;

  const porOperador = new Map<string, { pedido: number; separado: number; pedidos: number }>();
  for (const p of peds) {
    if (!p.operador_id) continue;
    const a = porOperador.get(p.operador_id) ?? { pedido: 0, separado: 0, pedidos: 0 };
    a.pedido += p.qtd_pedido;
    a.separado += p.qtd_separada;
    a.pedidos += 1;
    porOperador.set(p.operador_id, a);
  }

  return (
    <>
      <Titulo
        titulo="Painel"
        descricao="Acompanhamento em tempo real das remessas ativas."
        acoes={
          <Link to="/remessas/nova" className={classesBotao()}>
            <PackagePlus className="size-5" aria-hidden /> Nova remessa
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Remessas ativas" valor={fmtNum(ativas.length)} detalhe={`${fmtNum(peds.length)} pedidos`} />
        <Indicador
          rotulo="Separado"
          valor={fmtPct(totalSeparado, totalPedido)}
          detalhe={`${fmtNum(totalSeparado)} de ${fmtNum(totalPedido)} un.`}
          destaque="bg-ciano"
        />
        <Indicador
          rotulo="Pedidos completos"
          valor={`${fmtNum(completos)}/${fmtNum(peds.length)}`}
          detalhe={semOperador ? `${semOperador} sem operador` : "todos distribuídos"}
          destaque={semOperador ? "bg-amarelo" : "bg-ciano"}
        />
        <Indicador
          rotulo="Equipe online"
          valor={`${online}/${equipe.length}`}
          detalhe="ativos nos últimos 5 min"
          destaque="bg-amarelo"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {/* Remessas ativas */}
          <Cartao>
            <div className="flex items-center justify-between border-b border-borda px-5 py-4">
              <h2 className="font-semibold">Remessas ativas</h2>
              <Link to="/remessas" className="text-sm font-medium text-azul-escuro hover:underline">
                Ver todas
              </Link>
            </div>
            {ativas.length === 0 ? (
              <Vazio icone={<PackagePlus className="size-8" />} titulo="Nenhuma remessa ativa">
                Importe uma remessa e ative para os operadores começarem a separar.
              </Vazio>
            ) : (
              <ul className="divide-y divide-borda">
                {ativas.map((r) => (
                  <li key={r.id}>
                    <Link to={`/remessas/${r.id}`} className="group block px-5 py-4 hover:bg-fundo">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-semibold">Remessa {r.codigo}</p>
                          <p className="text-xs text-suave">
                            {r.lojas} lojas · {r.pedidos} pedidos · {fmtNum(r.qtd_pedido)} un.
                            {r.pedidos_sem_operador > 0 && (
                              <span className="ml-2 inline-flex items-center gap-1 font-medium text-[#7a5200]">
                                <UserX className="size-3.5" /> {r.pedidos_sem_operador} sem operador
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="tabular text-lg font-semibold">{fmtPct(r.qtd_separada, r.qtd_pedido)}</span>
                          <ArrowRight className="size-4 text-suave transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                      <Barra parte={r.qtd_separada} total={r.qtd_pedido} className="mt-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          {/* Equipe */}
          <Cartao>
            <div className="border-b border-borda px-5 py-4">
              <h2 className="font-semibold">Equipe</h2>
            </div>
            <ul className="divide-y divide-borda">
              {equipe.map((u) => {
                const s = situacaoOnline(u.ultima_atividade);
                const prog = porOperador.get(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-4 px-5 py-3">
                    <span className={cx("size-2.5 shrink-0 rounded-full", PONTO[s])} title={s} aria-label={s} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.nome}</p>
                      <p className="text-xs text-suave">
                        {u.papel === "supervisor" ? "Supervisor" : u.cargo || "Operador"} · visto {tempoRelativo(u.ultima_atividade)}
                      </p>
                    </div>
                    {prog ? (
                      <div className="w-36 text-right">
                        <p className="tabular text-sm font-semibold">
                          {fmtNum(prog.separado)}/{fmtNum(prog.pedido)}
                        </p>
                        <Barra parte={prog.separado} total={prog.pedido} className="mt-1" />
                      </div>
                    ) : (
                      <span className="text-xs text-suave">sem pedidos</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Cartao>
        </div>

        {/* Bips recentes */}
        <Cartao className="self-start">
          <div className="flex items-center justify-between border-b border-borda px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <Radio className="size-4 text-ciano-escuro" aria-hidden /> Bips recentes
            </h2>
            <Link to="/bips" className="text-sm font-medium text-azul-escuro hover:underline">
              Ver log
            </Link>
          </div>
          {(bips.dados ?? []).length === 0 ? (
            <Vazio icone={<ScanBarcode className="size-8" />} titulo="Nenhum bip ainda" />
          ) : (
            <ul className="divide-y divide-borda">
              {(bips.dados ?? []).map((b) => (
                <li key={b.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={cx(
                      "tabular mt-0.5 grid h-7 min-w-11 place-items-center rounded-lg px-1.5 text-sm font-semibold",
                      b.tipo === "ajuste" ? "bg-amarelo-claro text-[#7a5200]" : "bg-ciano-claro text-ciano-escuro",
                    )}
                  >
                    {b.qtd > 0 ? "+" : ""}
                    {b.qtd}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.produto}</p>
                    <p className="truncate text-xs text-suave">
                      <Store className="mr-1 inline size-3" aria-hidden />
                      {nomeLoja(b.loja_nome, b.loja_numero)} · {b.operador_nome ?? "—"}
                    </p>
                  </div>
                  <time className="tabular shrink-0 text-xs text-suave" dateTime={b.criado_em}>
                    {fmtDataHora(b.criado_em).slice(-8)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}
