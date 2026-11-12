import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LogIn } from "lucide-react";
import { useAuth } from "../lib/auth";
import { CurvasMarca, Logo } from "../components/Logo";
import { AvisoErro, Botao, Campo } from "../components/ui";

export default function Login() {
  const { perfil, entrar } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (perfil) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(login, senha);
      const de = (local.state as { de?: string } | null)?.de;
      navegar(de && de !== "/login" ? de : "/", { replace: true });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Lado da marca */}
      <div className="relative hidden overflow-hidden bg-navy lg:block">
        <CurvasMarca className="absolute inset-0 h-full w-full text-azul" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo variante="negativo" className="h-10 self-start" />
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-amarelo uppercase">WMS · Logística</p>
            <h1 className="mt-3 max-w-md text-4xl leading-tight font-semibold text-white">
              Separação de remessas, do bip à conferência.
            </h1>
            <p className="mt-4 max-w-md text-white/70">Negócios sem fronteiras.</p>
          </div>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10 h-9 lg:hidden" />
          <h2 className="text-2xl font-semibold text-navy">Entrar</h2>
          <p className="mt-1 text-sm text-suave">Use o login e a senha que o supervisor cadastrou para você.</p>

          <form onSubmit={enviar} className="mt-8 space-y-4">
            <Campo
              rotulo="Login"
              name="login"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="ex.: joao.silva"
            />
            <Campo
              rotulo="Senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            {erro && <AvisoErro>{erro}</AvisoErro>}
            <Botao type="submit" tamanho="lg" className="w-full" carregando={enviando} icone={<LogIn className="size-5" />}>
              Entrar
            </Botao>
          </form>
          <p className="mt-10 text-xs text-suave">Esqueceu a senha? Peça ao supervisor para redefinir na tela Usuários.</p>
        </div>
      </div>
    </div>
  );
}
