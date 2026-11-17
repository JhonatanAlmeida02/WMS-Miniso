import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, UserPlus, Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { chamarUsuarios, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { nomeLoja, situacaoOnline, tempoRelativo } from "../lib/formato";
import type { Loja, Papel, Perfil } from "../lib/tipos";
import { AvisoErro, Botao, Campo, Cartao, Carregando, Modal, Selecao, Selo, Titulo, Vazio, cx } from "../components/ui";

type Edicao = { modo: "novo" } | { modo: "editar"; perfil: Perfil } | { modo: "senha"; perfil: Perfil };

function Formulario({ edicao, lojas, aoSalvar, aoFechar }: { edicao: Edicao; lojas: Loja[]; aoSalvar: () => void; aoFechar: () => void }) {
  const p = edicao.modo !== "novo" ? edicao.perfil : null;
  const [login, setLogin] = useState("");
  const [nome, setNome] = useState(p?.nome ?? "");
  const [cargo, setCargo] = useState(p?.cargo ?? "");
  const [papel, setPapel] = useState<Papel>(p?.papel ?? "operador");
  const [lojaId, setLojaId] = useState(p?.loja_id ? String(p.loja_id) : "");
  const [senha, setSenha] = useState("");
  // Usuário de loja não volta a ser equipe interna (o banco também impede)
  const eraDeLoja = p?.loja_id != null;
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (edicao.modo === "novo") {
        await chamarUsuarios({ acao: "criar", login, nome, cargo, papel, senha, ...(papel === "operador" && lojaId ? { loja_id: Number(lojaId) } : {}) });
        toast.success(`Usuário ${login} criado`);
      } else if (edicao.modo === "editar") {
        await chamarUsuarios({ acao: "atualizar", id: edicao.perfil.id, nome, cargo, papel, ...(lojaId ? { loja_id: Number(lojaId) } : {}) });
        toast.success("Usuário atualizado");
      } else {
        await chamarUsuarios({ acao: "atualizar", id: edicao.perfil.id, senha });
        toast.success(`Senha de ${edicao.perfil.nome} redefinida`);
      }
      aoSalvar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {edicao.modo === "novo" && (
        <Campo
          rotulo="Login"
          required
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={login}
          onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s/g, ""))}
          ajuda="Usado para entrar. Letras minúsculas, números, ponto ou hífen (ex.: joao.silva)."
          pattern="[a-z0-9._\-]{3,40}"
        />
      )}
      {edicao.modo !== "senha" && (
        <>
          <Campo rotulo="Nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao rotulo="Perfil" value={papel} onChange={(e) => setPapel(e.target.value as Papel)} disabled={eraDeLoja}>
              <option value="operador">Operador</option>
              <option value="supervisor">Supervisor</option>
            </Selecao>
            <Campo rotulo="Cargo (opcional)" value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </div>
          {papel === "operador" && (
            <Selecao rotulo="Onde trabalha" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
              {!eraDeLoja && <option value="">Equipe PRODIGY (CD): separa e confere</option>}
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  Administrador da loja {nomeLoja(l.nome, l.numero)}
                </option>
              ))}
            </Selecao>
          )}
          {lojaId && (
            <p className="rounded-xl bg-azul-claro px-3 py-2 text-xs text-azul-escuro">
              Vê só o painel e as entregas desta loja e confere o recebimento. Não entra na separação nem na conferência do CD. Para tirar o acesso, desative o
              usuário.
            </p>
          )}
        </>
      )}
      {edicao.modo !== "editar" && (
        <Campo
          rotulo={edicao.modo === "senha" ? "Nova senha" : "Senha"}
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          ajuda="Mínimo de 6 caracteres. Passe para a pessoa pessoalmente."
        />
      )}
      {erro && <AvisoErro>{erro}</AvisoErro>}
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao type="submit" carregando={salvando}>
          {edicao.modo === "novo" ? "Criar usuário" : edicao.modo === "senha" ? "Redefinir senha" : "Salvar"}
        </Botao>
      </div>
    </form>
  );
}

export default function Usuarios() {
  const { perfil: eu } = useAuth();
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [mudando, setMudando] = useState<string | null>(null);
  const { dados, carregando, erro, recarregar } = useConsulta<Perfil[]>(
    () => supabase.from("perfis").select("*").order("ativo", { ascending: false }).order("nome"),
    [],
  );
  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*").order("numero", { ascending: true, nullsFirst: false }).order("nome"), []);
  const nomeDaLoja = (id: number) => {
    const l = (lojas.dados ?? []).find((x) => x.id === id);
    return l ? nomeLoja(l.nome, l.numero) : "loja";
  };

  async function alternarAtivo(p: Perfil) {
    setMudando(p.id);
    try {
      await chamarUsuarios({ acao: "atualizar", id: p.id, ativo: !p.ativo });
      toast.success(p.ativo ? `${p.nome} desativado` : `${p.nome} reativado`);
      recarregar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMudando(null);
    }
  }

  return (
    <>
      <Titulo
        titulo="Usuários"
        descricao="Quem pode entrar no WMS. Senhas ficam criptografadas; ninguém consegue ver, só redefinir."
        acoes={
          <Botao icone={<UserPlus className="size-4" />} onClick={() => setEdicao({ modo: "novo" })}>
            Novo usuário
          </Botao>
        }
      />
      {erro && <AvisoErro>{erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        {carregando && !dados ? (
          <Carregando />
        ) : (dados ?? []).length === 0 ? (
          <Vazio icone={<Users className="size-8" />} titulo="Nenhum usuário" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                <tr>
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-3 py-3">Login</th>
                  <th className="px-3 py-3">Perfil</th>
                  <th className="px-3 py-3">Última atividade</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {(dados ?? []).map((p) => {
                  const s = situacaoOnline(p.ultima_atividade);
                  return (
                    <tr key={p.id} className={cx(!p.ativo && "bg-fundo/60 text-suave")}>
                      <td className="px-5 py-3">
                        <span className="font-medium">{p.nome}</span>
                        {p.cargo && <span className="block text-xs text-suave">{p.cargo}</span>}
                      </td>
                      <td className="tabular px-3 py-3">{p.login}</td>
                      <td className="px-3 py-3">
                        {!p.ativo ? (
                          <Selo className="bg-navy/8 text-suave">Desativado</Selo>
                        ) : p.papel === "supervisor" ? (
                          <Selo className="bg-navy text-white">Supervisor</Selo>
                        ) : p.loja_id != null ? (
                          <Selo className="bg-ciano-claro text-ciano-escuro">Loja {nomeDaLoja(p.loja_id)}</Selo>
                        ) : (
                          <Selo className="bg-azul-claro text-azul-escuro">Operador</Selo>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={cx(
                              "size-2 rounded-full",
                              s === "online" ? "bg-ciano" : s === "inativo" ? "bg-amarelo" : "bg-navy/20",
                            )}
                            aria-hidden
                          />
                          {tempoRelativo(p.ultima_atividade)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            icone={<Pencil className="size-4" />}
                            onClick={() => setEdicao({ modo: "editar", perfil: p })}
                          >
                            Editar
                          </Botao>
                          <Botao
                            variante="fantasma"
                            tamanho="sm"
                            icone={<KeyRound className="size-4" />}
                            onClick={() => setEdicao({ modo: "senha", perfil: p })}
                          >
                            Senha
                          </Botao>
                          {p.id !== eu?.id && (
                            <Botao
                              variante={p.ativo ? "perigo" : "secundario"}
                              tamanho="sm"
                              carregando={mudando === p.id}
                              onClick={() => alternarAtivo(p)}
                            >
                              {p.ativo ? "Desativar" : "Reativar"}
                            </Botao>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Modal
        aberto={!!edicao}
        aoFechar={() => setEdicao(null)}
        titulo={
          edicao?.modo === "novo"
            ? "Novo usuário"
            : edicao?.modo === "senha"
              ? `Redefinir senha de ${edicao.perfil.nome}`
              : `Editar ${edicao?.modo === "editar" ? edicao.perfil.nome : ""}`
        }
      >
        {edicao && (
          <Formulario
            key={edicao.modo + (edicao.modo !== "novo" ? edicao.perfil.id : "")}
            edicao={edicao}
            lojas={lojas.dados ?? []}
            aoFechar={() => setEdicao(null)}
            aoSalvar={() => {
              setEdicao(null);
              recarregar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
