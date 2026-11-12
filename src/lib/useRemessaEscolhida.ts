import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "./supabase";
import { useConsulta } from "./useConsulta";
import type { Remessa } from "./tipos";

/**
 * Lista de remessas para escolher numa tela e a escolhida (?remessa=ID na URL).
 * Sem escolha, usa a primeira ativa (como o varRemessaAtual do Power Apps),
 * mas aqui o supervisor sempre vê e pode trocar.
 */
export function useRemessaEscolhida(incluirConcluidas = false) {
  const [params, setParams] = useSearchParams();
  const remessas = useConsulta<Remessa[]>(
    () => {
      let q = supabase.from("v_remessas").select("*").order("criado_em", { ascending: false }).limit(100);
      if (!incluirConcluidas) q = q.neq("status", "concluida");
      return q;
    },
    [incluirConcluidas],
    { tabelas: ["remessas"] },
  );
  const lista = remessas.dados ?? [];
  const idUrl = Number(params.get("remessa")) || null;
  const padrao = lista.find((r) => r.status === "ativa") ?? lista[0] ?? null;
  const escolhida = lista.find((r) => r.id === idUrl) ?? (idUrl ? null : padrao);

  useEffect(() => {
    if (!idUrl && padrao) setParams({ remessa: String(padrao.id) }, { replace: true });
  }, [idUrl, padrao, setParams]);

  const escolher = (id: number) => setParams({ remessa: String(id) });
  return { lista, escolhida, escolher, carregando: remessas.carregando && !remessas.dados };
}
