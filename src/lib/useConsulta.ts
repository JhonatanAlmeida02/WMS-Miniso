import { useCallback, useEffect, useRef, useState } from "react";
import { mensagemErro, supabase } from "./supabase";

type Tabela = "bips" | "itens_pedido" | "pedidos" | "remessas";

let contadorCanal = 0;

/**
 * Carrega dados e recarrega sozinho quando alguma das tabelas muda
 * (Supabase Realtime). Substitui o Refresh() por timer do Power Apps.
 */
export function useConsulta<T>(
  buscar: () => PromiseLike<{ data: T | null; error: unknown }>,
  deps: unknown[],
  opcoes: { tabelas?: Tabela[]; ativo?: boolean } = {},
) {
  const { tabelas = [], ativo = true } = opcoes;
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
      clearTimeout(timer);
      timer = setTimeout(recarregar, 400);
    };
    const canal = supabase.channel(`consulta-${++contadorCanal}`);
    for (const t of chaveTabelas.split(",")) {
      canal.on("postgres_changes", { event: "*", schema: "public", table: t }, agendar);
    }
    canal.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(canal);
    };
  }, [ativo, chaveTabelas, recarregar]);

  return { dados, erro, carregando, recarregar };
}
