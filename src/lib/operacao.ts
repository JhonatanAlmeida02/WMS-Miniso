import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Identificador de uma operação de escrita. É criado UMA vez por ação (uma
 * leitura, uma expedição) e reaproveitado nas novas tentativas: o banco grava
 * uma vez só. Uma nova leitura física recebe um identificador novo.
 */
export function novaOperacao(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Coletor abrindo o app por http na rede local não tem randomUUID
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function erroDeRede(erro: unknown) {
  const m = (erro as { message?: string } | null)?.message ?? String(erro);
  return /Failed to fetch|NetworkError|network|Load failed|timeout|fetch/i.test(m);
}

/**
 * Chama uma função do banco. Se a resposta se perder na rede, repete com os
 * MESMOS argumentos (inclusive o identificador da operação) antes de desistir.
 */
export async function rpcSegura<T>(funcao: string, args: Record<string, unknown>, tentativas = 3) {
  let ultimo: unknown = null;
  for (let i = 0; i < tentativas; i++) {
    const { data, error } = await supabase.rpc(funcao, args);
    if (!error) return { data: data as T, error: null };
    ultimo = error;
    if (!erroDeRede(error)) break;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { data: null, error: ultimo };
}

/** Está com internet? (o navegador avisa quando cai e quando volta) */
export function useConexao() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
