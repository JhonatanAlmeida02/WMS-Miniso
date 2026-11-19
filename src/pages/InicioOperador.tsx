import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, CheckCheck, ClipboardCheck, Gauge, LayoutDashboard, LogOut, PackageCheck, ScanBarcode, Timer, Undo2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ehGestor } from "../lib/papeis";
import { supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum, fmtPct } from "../lib/formato";
import type { ConferenciaLoja, PedidoResumo } from "../lib/tipos";
import { Logo } from "../components/Logo";
import { SeloLoja } from "../components/SeloLoja";
import { Barra, Carregando, cx } from "../components/ui";

interface MeuDia {
  unidades: number;
  bips: number;
  ajustes: number;
  ativo_seg: number;
}

function inicioDoDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fmtDuracao(seg: number) {
  if (!seg) return "0 min";
  if (seg < 60) return "menos de 1 min";
  const min = Math.round(seg / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function Numero({ icone, rotulo, valor }: { icone: ReactNode; rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-borda">
      <p className="flex items-center gap-1.5 text-xs text-suave">
        <span className="text-azul" aria-hidden>
          {icone}
        </span>
        {rotulo}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold">{valor}</p>
    </div>
  );
}

/** Tela de início do operador: escolher Separar ou Conferir e ver o próprio andamento. */
export default function InicioOperador() {
  const { perfil, sair } = useAuth();
  const meuId = perfil?.id ?? "";

  const pedidos = useConsulta<PedidoResumo[]>(
    () =>
      supabase
        .from("v_pedidos")
        .select("*")
        .eq("operador_id", meuId)
        .eq("remessa_status", "ativa")
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome"),
    [meuId],
    { tabelas: ["pedidos", "remessas"] },
  );

  const conferencias = useConsulta<ConferenciaLoja[]>(
    async () => {
      const { data: ativas } = await supabase.from("remessas").select("id").eq("status", "ativa");
      const ids = (ativas ?? []).map((r) => r.id);
      if (!ids.length) return { data: [] as ConferenciaLoja[], error: null };
      const r = await supabase
        .from("v_conferencia_lojas")
        .select("*")
        .eq("conferente_id", meuId)
        .in("remessa_id", ids)
        .order("loja_numero", { ascending: true, nullsFirst: false })
        .order("loja_nome");
      return { data: (r.data ?? []) as ConferenciaLoja[], error: r.error };
    },
    [meuId],
    { tabelas: ["pedidos", "remessas", "conferencias"] },
  );

  const hoje = useConsulta<MeuDia | null>(
    async () => {
      const { data, error } = await supabase.rpc("estatisticas_separacao", { p_inicio: inicioDoDia() });
      const eu = (data?.operadores ?? []).find((o: { operador_id: string }) => o.operador_id === meuId) as MeuDia | undefined;
      return { data: eu ?? { unidades: 0, bips: 0, ajustes: 0, ativo_seg: 0 }, error };
    },
    [meuId],
  );
  // números do dia: atualiza a cada minuto e ao voltar para esta tela
  const recarregarHoje = hoje.recarregar;
  useEffect(() => {
    const t = setInterval(recarregarHoje, 60_000);
    return () => clearInterval(t);
  }, [recarregarHoje]);

  const lojas = pedidos.dados ?? [];
  const confs = conferencias.dados ?? [];
  const total = lojas.reduce((s, p) => s + p.qtd_pedido, 0);
  const feito = lojas.reduce((s, p) => s + p.qtd_separada, 0);
  const lojasCompletas = lojas.filter((p) => p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido).length;
  const confFinalizadas = confs.filter((c) => c.status === "finalizada").length;
  const confPendentes = confs.length - confFinalizadas;
  const remessas = [...new Set([...lojas.map((p) => p.remessa_codigo)])];
  const dia = hoje.dados;
  const ritmo = dia && dia.ativo_seg > 0 ? dia.unidades / (dia.ativo_seg / 60) : null;
  const primeiroNome = (perfil?.nome ?? "").split(" ")[0];

  return (
    <div className="min-h-dvh bg-fundo">
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Logo simbolo className="h-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Olá, {primeiroNome}</p>
            <p className="truncate text-xs text-white/65">{remessas.length ? `Remessa ${remessas.join(", ")}` : "Sem remessa ativa para você"}</p>
          </div>
          {ehGestor(perfil) && (
            <Link to="/painel" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10">
              <LayoutDashboard className="size-4" /> <span className="hidden sm:inline">Painel</span>
            </Link>
          )}
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        {/* As duas tarefas */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/separacao" className="group flex flex-col gap-3 rounded-3xl bg-navy p-5 text-white shadow-sm transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-ciano text-navy">
                <ScanBarcode className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-semibold">Separar</p>
                <p className="text-sm text-white/70">
                  {lojas.length ? `${lojasCompletas} de ${lojas.length} lojas completas` : "Nenhuma loja atribuída"}
                </p>
              </div>
              <ArrowRight className="size-6 text-white/60 transition-transform group-hover:translate-x-1" aria-hidden />
            </div>
            {lojas.length > 0 && (
              <>
                <Barra parte={feito} total={total} className="h-2.5 bg-white/15" />
                <p className="tabular text-sm text-white/80">
                  {fmtNum(feito)} de {fmtNum(total)} un. · <strong className="text-white">falta {fmtNum(total - feito)}</strong> ·{" "}
                  {fmtPct(feito, total)}
                </p>
              </>
            )}
          </Link>

          <Link to="/conferir" className="group flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-borda transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-azul-claro text-azul-escuro">
                <ClipboardCheck className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-semibold">Conferir</p>
                <p className="text-sm text-suave">
                  {confs.length
                    ? `${confPendentes} ${confPendentes === 1 ? "loja pendente" : "lojas pendentes"} · ${confFinalizadas} feitas`
                    : "Nenhuma conferência atribuída"}
                </p>
              </div>
              <ArrowRight className="size-6 text-suave transition-transform group-hover:translate-x-1" aria-hidden />
            </div>
            {confs.length > 0 && (
              <>
                <Barra parte={confFinalizadas} total={confs.length} className="h-2.5" />
                <p className="tabular text-sm text-suave">
                  {confFinalizadas} de {confs.length} conferidas
                </p>
              </>
            )}
          </Link>
        </div>

        {/* O meu dia */}
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold">Hoje</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero icone={<PackageCheck className="size-4" />} rotulo="Unidades separadas" valor={fmtNum(dia?.unidades ?? 0)} />
            <Numero
              icone={<Gauge className="size-4" />}
              rotulo="Unidades por minuto"
              valor={ritmo == null ? "—" : ritmo.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}
            />
            <Numero icone={<Timer className="size-4" />} rotulo="Tempo ativo" valor={fmtDuracao(dia?.ativo_seg ?? 0)} />
            <Numero icone={<Undo2 className="size-4" />} rotulo="Ajustes" valor={fmtNum(dia?.ajustes ?? 0)} />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Lojas para separar */}
          <section className="rounded-2xl bg-white ring-1 ring-borda">
            <h2 className="border-b border-borda px-4 py-3 text-sm font-semibold">Minhas lojas para separar</h2>
            {pedidos.carregando && !pedidos.dados ? (
              <Carregando />
            ) : lojas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-suave">Quando o supervisor distribuir e ativar a remessa, suas lojas aparecem aqui.</p>
            ) : (
              <ul className="divide-y divide-borda">
                {lojas.map((p) => {
                  const completa = p.qtd_pedido > 0 && p.qtd_separada >= p.qtd_pedido;
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <SeloLoja numero={p.loja_numero} nome={p.loja_nome} className="size-10 text-base" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{p.loja_nome}</p>
                          {completa ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ciano-escuro">
                              <CheckCheck className="size-3.5" /> Completa
                            </span>
                          ) : (
                            <span className="tabular shrink-0 text-xs font-semibold">falta {fmtNum(p.qtd_pedido - p.qtd_separada)}</span>
                          )}
                        </div>
                        <Barra parte={p.qtd_separada} total={p.qtd_pedido} className="mt-1.5 h-1.5" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Conferências atribuídas */}
          <section className="rounded-2xl bg-white ring-1 ring-borda">
            <h2 className="border-b border-borda px-4 py-3 text-sm font-semibold">Minhas conferências</h2>
            {conferencias.carregando && !conferencias.dados ? (
              <Carregando />
            ) : confs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-suave">Quando o supervisor atribuir lojas para você conferir, elas aparecem aqui.</p>
            ) : (
              <ul className="divide-y divide-borda">
                {confs.map((c) => (
                  <li key={c.pedido_id}>
                    <Link to={`/conferir?remessa=${c.remessa_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-fundo">
                      <SeloLoja numero={c.loja_numero} nome={c.loja_nome} className="size-10 text-base" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.loja_nome}</p>
                        <p className="tabular text-xs text-suave">Separado {fmtNum(c.qtd_separada)} un.</p>
                      </div>
                      <span
                        className={cx(
                          "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                          !c.status
                            ? "bg-navy/8 text-suave"
                            : c.status === "em_andamento"
                              ? "bg-azul-claro text-azul-escuro"
                              : c.divergencias
                                ? "bg-erro-claro text-erro"
                                : "bg-ciano-claro text-ciano-escuro",
                        )}
                      >
                        {!c.status
                          ? "A conferir"
                          : c.status === "em_andamento"
                            ? "Em andamento"
                            : c.divergencias
                              ? `${c.divergencias} divergência${c.divergencias === 1 ? "" : "s"}`
                              : "OK"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
