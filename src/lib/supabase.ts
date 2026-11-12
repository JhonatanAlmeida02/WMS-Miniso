import { createClient } from "@supabase/supabase-js";

const urlEnv = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Em desenvolvimento dá para usar um caminho relativo (ex.: "/sb") que o Vite
// repassa ao Supabase local; assim o app abre de outro aparelho na rede.
const url = urlEnv?.startsWith("/") ? `${window.location.origin}${urlEnv}` : urlEnv;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configurado = Boolean(url && chave);

export const supabase = createClient(url ?? "http://localhost", chave ?? "sem-chave", {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Domínio interno: o usuário digita só o login, o Supabase Auth usa e-mail. */
export const DOMINIO_LOGIN = "usuarios.prodigy-wms.local";
export const emailDoLogin = (login: string) => `${login.trim().toLowerCase()}@${DOMINIO_LOGIN}`;

/** Mensagem de erro do Postgres/Supabase em português para mostrar ao usuário. */
export function mensagemErro(erro: unknown): string {
  if (!erro) return "Erro desconhecido";
  const m = (erro as { message?: string }).message ?? String(erro);
  if (/Invalid login credentials/i.test(m)) return "Login ou senha incorretos";
  if (/User is banned/i.test(m)) return "Usuário desativado. Fale com o supervisor.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão com o servidor. Verifique a internet.";
  if (/JWT expired/i.test(m)) return "Sessão expirada. Entre novamente.";
  return m;
}

/** Chama a Edge Function de usuários e devolve o erro já em texto. */
export async function chamarUsuarios(corpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("usuarios", { body: corpo });
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
