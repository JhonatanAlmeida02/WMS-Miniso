import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { mensagemErro, supabase } from "./supabase";

/**
 * Tabelas com tempo real. itens_pedido não entra: toda mudança de item vem de
 * um bip (registrar_bip grava em bips), então quem precisa de saldo escuta bips.
 */
type Tabela = "bips" | "pedidos" | "remessas";

// Um canal por tabela para o app inteiro, compartilhado por todas as telas
// abertas: cada mudança no banco chega uma vez só (cota de mensagens do Supabase).
const ouvintes = new Map<Tabela, Set<() => void>>();
const canais = new Map<Tabela, RealtimeChannel>();

function ouvir(tabela: Tabela, fn: () => void) {
  let lista = ouvintes.get(tabela);
  if (!lista) {
    lista = new Set();
    ouvintes.set(tabela, lista);
  }
  lista.add(fn);
  if (!canais.has(tabela)) {
    const canal = supabase
      .channel(`tabela-${tabela}`)
      .on("postgres_changes", { event: "*", schema: "public", table: tabela }, () => {
        for (const f of ouvintes.get(tabela) ?? []) f();
      })
      .subscribe();
    canais.set(tabela, canal);
  }
  return () => {
    lista.delete(fn);
    if (lista.size === 0) {
      const canal = canais.get(tabela);
      if (canal) supabase.removeChannel(canal);
      canais.delete(tabela);
    }
  };
}

/**
 * Carrega dados e recarrega sozinho quando alguma das tabelas muda
 * (Supabase Realtime). Substitui o Refresh() por timer do Power Apps.
 * Mudanças em sequência (vários bips) viram um recarregamento só.
 */
export function useConsulta<T>(
  buscar: () => PromiseLike<{ data: T | null; error: unknown }>,
  deps: unknown[],
  opcoes: { tabelas?: Tabela[]; ativo?: boolean; atraso?: number } = {},
) {
  const { tabelas = [], ativo = true, atraso = 800 } = opcoes;
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;
  const seq = useRef(0);

  const recarregar = useCallback(async () => {
    const minha = ++seq.current;
    const { data, error } = await buscarRef.current();
    if (minha !== seq.current) return; // resposta antiga
    if (error) setErro(mensagemErro(error));
    else {
      setErro(null);
      setDados(data);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    setCarregando(true);
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, recarregar, ...deps]);

  const chaveTabelas = tabelas.join(",");
  useEffect(() => {
    if (!ativo || !chaveTabelas) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
      if (timer) return; // já tem um recarregamento marcado
      timer = setTimeout(() => {
        timer = undefined;
        recarregar();
      }, atraso);
    };
    const cancelar = (chaveTabelas.split(",") as Tabela[]).map((t) => ouvir(t, agendar));
    return () => {
      clearTimeout(timer);
      cancelar.forEach((c) => c());
    };
  }, [ativo, chaveTabelas, recarregar, atraso]);

  return { dados, erro, carregando, recarregar };
}
