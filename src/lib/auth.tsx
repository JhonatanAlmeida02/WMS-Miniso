import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { emailDoLogin, mensagemErro, supabase } from "./supabase";
import type { Perfil } from "./tipos";

interface AuthCtx {
  carregando: boolean;
  sessao: Session | null;
  perfil: Perfil | null;
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setPerfil(null);
      return;
    }
    const { data } = await supabase.from("perfis").select("*").eq("id", s.user.id).maybeSingle();
    setPerfil((data as Perfil | null) ?? null);
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSessao(data.session);
      await carregarPerfil(data.session);
      if (vivo) setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      if (evento === "SIGNED_OUT") setPerfil(null);
      // carregar perfil fora do callback (recomendação do supabase-js)
      if (evento === "SIGNED_IN" || evento === "USER_UPDATED") setTimeout(() => carregarPerfil(s), 0);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [carregarPerfil]);

  // Batimento de "online" a cada minuto (era o timer do cmpHeader)
  useEffect(() => {
    if (!perfil?.ativo) return;
    const bater = () => supabase.rpc("registrar_atividade").then(() => undefined);
    bater();
    const t = setInterval(bater, 60_000);
    return () => clearInterval(t);
  }, [perfil?.id, perfil?.ativo]);

  const entrar = useCallback(
    async (login: string, senha: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailDoLogin(login),
        password: senha,
      });
      if (error) throw new Error(mensagemErro(error));
      const { data: p } = await supabase.from("perfis").select("*").eq("id", data.user.id).maybeSingle();
      if (!p || !(p as Perfil).ativo) {
        await supabase.auth.signOut();
        throw new Error("Usuário sem acesso ao WMS. Fale com o supervisor.");
      }
      setPerfil(p as Perfil);
    },
    [],
  );

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    setPerfil(null);
  }, []);

  return <Ctx.Provider value={{ carregando, sessao, perfil, entrar, sair }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}
