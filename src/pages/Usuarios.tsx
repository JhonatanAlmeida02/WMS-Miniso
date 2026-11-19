import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { useAuth } from "../lib/auth";
import { chamarUsuarios, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { situacaoOnline, tempoRelativo } from "../lib/formato";
import type { EscopoVisualizador, Loja, Papel, Perfil } from "../lib/tipos";
import { ROTULO_ESCOPO, ROTULO_PAPEL, ehAdministrador, ehOwner, papeisQueConcede } from "../lib/papeis";
import { nomeLoja } from "../lib/formato";
import { AvisoErro, Botao, Campo, Cartao, Carregando, Modal, Selecao, Selo, Titulo, Vazio, cx, useConfirmacao } from "../components/ui";

type Edicao = { modo: "novo" } | { modo: "editar"; perfil: Perfil } | { modo: "senha"; perfil: Perfil };

const DESCRICAO_PAPEL: Record<Papel, string> = {
  owner: "Acesso completo. Gerencia os administradores.",
  administrador: "Operação e configurações. Gerencia supervisores, operadores, visualizadores e os acessos das lojas.",
  supervisor: "Coordena a operação do CD: remessas, distribuição, conferência, expedição e recebimentos.",
  operador: "Separa e confere as tarefas atribuídas a ele.",
  visualizador: "Só consulta painéis e relatórios das lojas do seu escopo. Não grava nem exporta.",
};

/** O que o servidor também confere: quem pode mexer em quem. */
function podeGerir(eu: Perfil | null, alvo: Perfil) {
  if (!eu) return false;
  if (alvo.id === eu.id) return true;
  if (alvo.papel === "owner") return false;
  if (alvo.papel === "administrador") return ehOwner(eu);
  return ehAdministrador(eu);
}

function Formulario({
  edicao,
  eu,
  lojas,
  vinculos,
  aoSalvar,
  aoFechar,
}: {
  edicao: Edicao;
  eu: Perfil | null;
  lojas: Loja[];
  vinculos: number[];
  aoSalvar: () => void;
  aoFechar: () => void;
}) {
  const p = edicao.modo !== "novo" ? edicao.perfil : null;
  const concede = papeisQueConcede(eu);
  const proprio = !!p && p.id === eu?.id;
  // Papel que não pode ser trocado aqui (o próprio, ou fora do que eu concedo)
  const papelFixo = !!p && (proprio || !concede.includes(p.papel));
  const [login, setLogin] = useState("");
  const [nome, setNome] = useState(p?.nome ?? "");
  const [cargo, setCargo] = useState(p?.cargo ?? "");
  const [papel, setPapel] = useState<Papel>(p?.papel ?? "operador");
  const [escopo, setEscopo] = useState<EscopoVisualizador | "">(p?.escopo_visualizador ?? "");
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set(vinculos));
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const visualizador = papel === "visualizador";

  function alternarLoja(id: number) {
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (edicao.modo !== "senha" && visualizador && !escopo) {
      setErro("Escolha o escopo do visualizador: por loja ou Global MINISO.");
      return;
    }
    const doEscopo = visualizador ? { escopo, lojas: escopo === "lojas" ? [...marcadas] : [] } : {};
    setSalvando(true);
    try {
      if (edicao.modo === "novo") {
        await chamarUsuarios({ acao: "criar", login, nome, cargo, papel, senha, ...doEscopo });
        toast.success(`Usuário ${login} criado`);
      } else if (edicao.modo === "editar") {
        await chamarUsuarios({
          acao: "atualizar",
          id: edicao.perfil.id,
          nome,
          cargo,
          ...(papelFixo ? {} : { papel }),
          ...(!papelFixo || edicao.perfil.papel === "visualizador" ? doEscopo : {}),
        });
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
            {papelFixo ? (
              <div>
                <p className="mb-1.5 text-sm font-medium">Perfil</p>
                <p className="flex h-11 items-center rounded-xl bg-fundo px-3 text-sm">{ROTULO_PAPEL[papel]}</p>
              </div>
            ) : (
              <Selecao rotulo="Perfil" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
                {concede.map((k) => (
                  <option key={k} value={k}>
                    {ROTULO_PAPEL[k]}
                  </option>
                ))}
              </Selecao>
            )}
            <Campo rotulo="Cargo (opcional)" value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </div>
          <p className="-mt-2 text-xs text-suave">{DESCRICAO_PAPEL[papel]}</p>

          {visualizador && (!papelFixo || p?.papel === "visualizador") && (
            <fieldset className="space-y-3 rounded-2xl bg-fundo p-4">
              <legend className="sr-only">Escopo do visualizador</legend>
              <p className="text-sm font-medium">O que esta conta pode ver</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["lojas", "global_miniso"] as const).map((k) => (
                  <label
                    key={k}
                    className={cx(
                      "flex cursor-pointer items-start gap-2 rounded-xl bg-white p-3 text-sm ring-1",
                      escopo === k ? "ring-2 ring-azul" : "ring-borda",
                    )}
                  >
                    <input type="radio" name="escopo" className="mt-0.5 accent-azul" checked={escopo === k} onChange={() => setEscopo(k)} />
                    <span>
                      <span className="block font-semibold">{ROTULO_ESCOPO[k]}</span>
                      <span className="block text-xs text-suave">
                        {k === "lojas"
                          ? "Só as lojas marcadas abaixo. Loja nova precisa ser marcada."
                          : "Todas as lojas MINISO e a operação da PRODIGY ligada a elas, inclusive lojas novas."}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {escopo === "lojas" && (
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-suave">
                    <span>
                      {marcadas.size} {marcadas.size === 1 ? "loja marcada" : "lojas marcadas"}
                    </span>
                    {marcadas.size > 0 && (
                      <button type="button" className="font-medium text-azul-escuro hover:underline" onClick={() => setMarcadas(new Set())}>
                        Desmarcar todas
                      </button>
                    )}
                  </div>
                  <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl bg-white p-2 ring-1 ring-borda sm:grid-cols-2">
                    {lojas.map((l) => (
                      <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-azul-claro/40">
                        <input type="checkbox" className="size-4 accent-azul" checked={marcadas.has(l.id)} onChange={() => alternarLoja(l.id)} />
                        <span className="truncate">{nomeLoja(l.nome, l.numero)}</span>
                      </label>
                    ))}
                  </div>
                  {marcadas.size === 0 && <p className="mt-2 text-xs text-[#7a5200]">Sem nenhuma loja marcada, a conta entra mas não vê dados.</p>}
                </div>
              )}
            </fieldset>
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

const COR_PAPEL: Record<Papel, string> = {
  owner: "bg-amarelo text-navy",
  administrador: "bg-navy text-white",
  supervisor: "bg-azul text-white",
  operador: "bg-azul-claro text-azul-escuro",
  visualizador: "bg-ciano-claro text-[#00695f]",
};

export default function Usuarios() {
  const { perfil: eu } = useAuth();
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [mudando, setMudando] = useState<string | null>(null);
  const { dados, carregando, erro, recarregar } = useConsulta<Perfil[]>(
    () => supabase.from("perfis").select("*").order("ativo", { ascending: false }).order("nome"),
    [],
  );
  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*").order("numero").order("nome"), []);
  const vinculos = useConsulta<{ usuario_id: string; loja_id: number }[]>(
    () => supabase.from("visualizador_lojas").select("usuario_id, loja_id"),
    [],
  );
  const lojasDe = (id: string) => (vinculos.dados ?? []).filter((v) => v.usuario_id === id).map((v) => v.loja_id);
  const nomeDe = new Map((lojas.dados ?? []).map((l) => [l.id, nomeLoja(l.nome, l.numero)]));

  const [confirmar, dialogo] = useConfirmacao();

  async function excluir(p: Perfil) {
    const ok = await confirmar({
      titulo: `Excluir ${p.nome}?`,
      mensagem: (
        <>
          O login <strong>{p.login}</strong> deixa de existir e não dá para desfazer. O que a pessoa fez (bips, conferências,
          expedições) continua registrado, mas sem o nome dela. Para só bloquear o acesso e manter o nome no histórico, use{" "}
          <strong>Desativar</strong>.
        </>
      ),
      confirmar: "Excluir usuário",
      perigo: true,
    });
    if (!ok) return;
    setMudando(p.id);
    try {
      await chamarUsuarios({ acao: "excluir", id: p.id });
      toast.success(`${p.nome} excluído`);
      recarregar();
      vinculos.recarregar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMudando(null);
    }
  }

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
        descricao="Equipe da PRODIGY e visualizadores. Senhas ficam criptografadas; ninguém consegue ver, só redefinir. Usuários das lojas ficam em Lojas MINISO."
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
                        ) : (
                          <Selo className={COR_PAPEL[p.papel]}>{ROTULO_PAPEL[p.papel]}</Selo>
                        )}
                        {p.papel === "visualizador" && p.escopo_visualizador && (
                          <span className="mt-1 block max-w-56 truncate text-xs text-suave" title={lojasDe(p.id).map((id) => nomeDe.get(id)).join(", ")}>
                            {p.escopo_visualizador === "global_miniso"
                              ? "Global MINISO"
                              : `${lojasDe(p.id).length} ${lojasDe(p.id).length === 1 ? "loja" : "lojas"}: ${lojasDe(p.id).map((id) => nomeDe.get(id)).join(", ") || "nenhuma"}`}
                          </span>
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
                          {!podeGerir(eu, p) ? (
                            <span className="px-2 text-xs text-suave">{p.papel === "owner" ? "Conta Owner" : "Só o Owner altera"}</span>
                          ) : (
                          <>
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
                          {p.id !== eu?.id && p.papel !== "owner" && (
                            <Botao
                              variante="fantasma"
                              tamanho="sm"
                              icone={<Trash2 className="size-4" />}
                              className="text-erro hover:bg-erro-claro"
                              disabled={mudando === p.id}
                              onClick={() => excluir(p)}
                              aria-label={`Excluir ${p.nome}`}
                            >
                              Excluir
                            </Botao>
                          )}
                          </>
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

      {dialogo}
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
            eu={eu}
            lojas={lojas.dados ?? []}
            vinculos={edicao.modo !== "novo" ? lojasDe(edicao.perfil.id) : []}
            aoFechar={() => setEdicao(null)}
            aoSalvar={() => {
              setEdicao(null);
              recarregar();
              vinculos.recarregar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
