import { supabase } from "./supabase";

/** Usuário de loja (função usuarios_das_lojas, só supervisor). */
export interface UsuarioLoja {
  id: string;
  login: string;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  loja_id: number;
  admin_loja: boolean;
  ultima_atividade: string | null;
  criado_em: string;
}

/** Chama a função do servidor "usuarios-loja" e devolve o erro já em texto. */
export async function chamarUsuariosLoja(corpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("usuarios-loja", { body: corpo });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j?.erro) msg = j.erro;
      } catch {
        /* resposta sem JSON */
      }
    }
    throw new Error(msg);
  }
  return data;
}
