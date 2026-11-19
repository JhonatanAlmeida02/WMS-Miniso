import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowRight, ClipboardCheck, LogOut, PackageCheck, ScanBarcode, Truck } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { fmtDataHora, fmtNum, nomeLoja } from "../../lib/formato";
import type { Expedicao, Loja } from "../../lib/tipos";
import { Logo } from "../../components/Logo";
import { Barra, Carregando } from "../../components/ui";
import { SeloRecebimento, podeConferir } from "../../components/loja/comum";

interface MeuDia {
  unidades: number;
  leituras: number;
  avarias: number;
  finalizadas: number;
}

function inicioDoDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
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

/**
 * Início do conferente da loja: o mesmo modelo da tela do operador da PRODIGY,
 * só com a conferência (a loja não separa). Mostra as entregas a conferir e o
 * que a pessoa já fez hoje.
 */
export default function InicioConferente() {
  const { perfil, sair } = useAuth();
  const meuId = perfil?.id ?? "";
  const lojaId = perfil?.loja_id ?? -1;

  const loja = useConsulta<Loja>(() => supabase.from("lojas").select("*").eq("id", lojaId).maybeSingle(), [lojaId]);
  const entregas = useConsulta<Expedicao[]>(
    () => supabase.from("v_expedicoes").select("*").eq("loja_id", lojaId).order("expedida_em", { ascending: true }).limit(300),
    [lojaId],
    { tabelas: ["expedicoes", "recebimentos_loja", "divergencias"] },
  );
  const hoje = useConsulta<MeuDia>(
    async () => {
      const desde = inicioDoDia();
      const [b, f] = await Promise.all([
        supabase.from("recebimento_bips").select("qtd, avariado, estorno_de").eq("operador_id", meuId).gte("criado_em", desde).limit(10000),
        supabase.from("recebimentos_loja").select("id", { count: "exact", head: true }).eq("finalizado_por", meuId).gte("finalizado_em", desde),
      ]);
      const bips = (b.data ?? []) as { qtd: number; avariado: boolean; estorno_de: number | null }[];
      return {
        data: {
          unidades: bips.reduce((s, x) => s + x.qtd, 0),
          leituras: bips.filter((x) => x.estorno_de == null).length,
          avarias: bips.filter((x) => x.avariado).reduce((s, x) => s + x.qtd, 0),
          finalizadas: f.count ?? 0,
        },
        error: b.error ?? f.error,
      };
    },
    [meuId],
    { tabelas: ["recebimentos_loja"] },
  );
  // números do dia: atualiza a cada minuto e ao voltar para esta tela
  const recarregarHoje = hoje.recarregar;
  useEffect(() => {
    const t = setInterval(recarregarHoje, 60_000);
    return () => clearInterval(t);
  }, [recarregarHoje]);

  const todas = entregas.dados ?? [];
  const pendentes = todas.filter(podeConferir);
  const conferidas = todas.filter((e) => !podeConferir(e)).reverse().slice(0, 8);
  const proxima = pendentes.find((e) => e.recebimento_status === "em_conferencia") ?? pendentes[0];
  const dia = hoje.dados;
  const primeiroNome = (perfil?.nome ?? "").split(" ")[0];
  const nome = loja.dados ? nomeLoja(loja.dados.nome, loja.dados.numero) : null;
  const semAcesso = !loja.carregando && !loja.dados;

  const cartao = (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-azul-claro text-azul-escuro">
          <ClipboardCheck className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold">Conferir</p>
          <p className="text-sm text-suave">
            {pendentes.length
              ? `${pendentes.length} ${pendentes.length === 1 ? "entrega a conferir" : "entregas a conferir"} · ${todas.length - pendentes.length} conferidas`
              : "Nenhuma entrega para conferir agora"}
          </p>
        </div>
        {proxima && <ArrowRight className="size-6 text-suave transition-transform group-hover:translate-x-1" aria-hidden />}
      </div>
      {todas.length > 0 && (
        <>
          <Barra parte={todas.length - pendentes.length} total={todas.length} className="h-2.5" />
          <p className="tabular text-sm text-suave">
            {proxima
              ? `Próxima: pedido ${proxima.pedido_nome} · entrega ${proxima.numero} · ${proxima.volumes} vol.`
              : `${todas.length - pendentes.length} de ${todas.length} entregas conferidas`}
          </p>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-dvh bg-fundo">
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Logo simbolo className="h-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-tight font-semibold">Olá, {primeiroNome}</p>
            <p className="truncate text-xs text-white/65">{nome ? `Loja ${nome}` : "Conferente da loja"}</p>
          </div>
          <button type="button" onClick={sair} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sair" title="Sair">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        {semAcesso && (
          <div className="rounded-2xl bg-amarelo-claro px-4 py-3 text-sm text-[#7a5200] ring-1 ring-amarelo/40" role="alert">
            <p className="font-semibold">O acesso da sua loja ainda não foi liberado</p>
            <p>Enquanto a PRODIGY não liberar a loja, as entregas não aparecem aqui.</p>
          </div>
        )}

        {/* A tarefa: conferir (a loja não separa) */}
        {proxima ? (
          <Link
            to={`/loja/conferir/${proxima.recebimento_id}`}
            className="group flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-borda transition-transform hover:-translate-y-0.5"
          >
            {cartao}
          </Link>
        ) : (
          <div className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-borda">{cartao}</div>
        )}

        {/* O meu dia */}
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold">Hoje</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero icone={<PackageCheck className="size-4" />} rotulo="Unidades conferidas" valor={fmtNum(dia?.unidades ?? 0)} />
            <Numero icone={<ScanBarcode className="size-4" />} rotulo="Leituras" valor={fmtNum(dia?.leituras ?? 0)} />
            <Numero icone={<Truck className="size-4" />} rotulo="Entregas finalizadas" valor={fmtNum(dia?.finalizadas ?? 0)} />
            <Numero icone={<AlertTriangle className="size-4" />} rotulo="Avarias" valor={fmtNum(dia?.avarias ?? 0)} />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl bg-white ring-1 ring-borda">
            <h2 className="border-b border-borda px-4 py-3 text-sm font-semibold">Entregas para conferir</h2>
            {entregas.carregando && !entregas.dados ? (
              <Carregando />
            ) : pendentes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-suave">Quando a PRODIGY expedir uma entrega para a loja, ela aparece aqui.</p>
            ) : (
              <ul className="divide-y divide-borda">
                {pendentes.map((e) => (
                  <li key={e.id}>
                    <Link to={`/loja/conferir/${e.recebimento_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-fundo">
                      <span className="grid size-10 shrink-0 place-items-center rounded-[28%] bg-azul-claro text-azul-escuro">
                        <ScanBarcode className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          Pedido {e.pedido_nome} · entrega {e.numero}
                        </p>
                        <p className="tabular text-xs text-suave">
                          {e.volumes} vol. · {e.produtos} {e.produtos === 1 ? "produto" : "produtos"} · {fmtDataHora(e.expedida_em)}
                        </p>
                      </div>
                      <SeloRecebimento status={e.recebimento_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white ring-1 ring-borda">
            <h2 className="border-b border-borda px-4 py-3 text-sm font-semibold">Conferidas</h2>
            {entregas.carregando && !entregas.dados ? (
              <Carregando />
            ) : conferidas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-suave">As entregas finalizadas aparecem aqui.</p>
            ) : (
              <ul className="divide-y divide-borda">
                {conferidas.map((e) => (
                  <li key={e.id}>
                    <Link to={`/loja/conferir/${e.recebimento_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-fundo">
                      <span className="grid size-10 shrink-0 place-items-center rounded-[28%] bg-fundo text-base font-semibold text-azul-escuro">{e.numero}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">Pedido {e.pedido_nome}</p>
                        <p className="tabular text-xs text-suave">
                          {e.finalizado_em ? `Finalizada ${fmtDataHora(e.finalizado_em)}` : `${e.volumes} vol.`}
                          {e.finalizado_por_nome && ` · ${e.finalizado_por_nome}`}
                        </p>
                      </div>
                      <SeloRecebimento status={e.recebimento_status} />
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
