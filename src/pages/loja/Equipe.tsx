import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { KeyRound, UserPlus, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useConsulta } from "../../lib/useConsulta";
import { situacaoOnline, tempoRelativo } from "../../lib/formato";
import { chamarUsuariosLoja } from "../../lib/usuariosLoja";
import { AvisoErro, Botao, Campo, Cartao, Carregando, Modal, Selo, Titulo, Vazio, cx } from "../../components/ui";

interface Membro {
  id: string;
  login: string;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  admin_loja: boolean;
  ultima_atividade: string | null;
}

type Edicao = { modo: "novo" } | { modo: "senha"; m: Membro };

/**
 * Equipe da loja: o administrador cadastra os conferentes da própria loja.
 * O banco e a função do servidor garantem que ele só mexe na loja dele.
 */
export default function EquipeLoja() {
  const { perfil } = useAuth();
  const equipe = useConsulta<Membro[]>(() => supabase.rpc("equipe_da_minha_loja"), []);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [mudando, setMudando] = useState<string | null>(null);

  if (!perfil?.admin_loja) {
    return (
      <Cartao>
        <Vazio icone={<Users className="size-8" />} titulo="Só o administrador da loja cadastra a equipe" />
      </Cartao>
    );
  }

  async function alternar(m: Membro) {
    setMudando(m.id);
    try {
      await chamarUsuariosLoja({ acao: "atualizar", id: m.id, ativo: !m.ativo });
      toast.success(m.ativo ? `${m.nome} desativado` : `${m.nome} reativado`);
      equipe.recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMudando(null);
    }
  }

  const lista = equipe.dados ?? [];

  return (
    <>
      <Titulo
        titulo="Equipe da loja"
        descricao="Quem confere as entregas nesta loja. Cada pessoa tem o próprio login e vê só esta loja."
        acoes={
          <Botao icone={<UserPlus className="size-4" />} onClick={() => setEdicao({ modo: "novo" })}>
            Novo conferente
          </Botao>
        }
      />
      {equipe.erro && <AvisoErro>{equipe.erro}</AvisoErro>}
      <Cartao className="overflow-hidden">
        {equipe.carregando && !equipe.dados ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={<Users className="size-8" />} titulo="Ninguém cadastrado ainda" />
        ) : (
          <ul className="divide-y divide-borda">
            {lista.map((m) => {
              const s = situacaoOnline(m.ultima_atividade);
              const proprio = m.id === perfil.id;
              return (
                <li key={m.id} className={cx("flex flex-wrap items-center gap-3 px-5 py-3", !m.ativo && "bg-fundo/60 text-suave")}>
                  <span
                    className={cx("size-2.5 shrink-0 rounded-full", s === "online" ? "bg-ciano" : s === "inativo" ? "bg-amarelo" : "bg-navy/20")}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {m.nome}
                      {proprio && <span className="text-sm font-normal text-suave"> (você)</span>}
                    </p>
                    <p className="text-xs text-suave">
                      {m.login}
                      {m.cargo && ` · ${m.cargo}`} · visto {tempoRelativo(m.ultima_atividade)}
                    </p>
                  </div>
                  {m.admin_loja ? (
                    <Selo className="bg-navy text-white">Administrador</Selo>
                  ) : (
                    <Selo className="bg-azul-claro text-azul-escuro">Conferente</Selo>
                  )}
                  {!m.ativo && <Selo className="bg-navy/8 text-suave">Desativado</Selo>}
                  {!m.admin_loja && (
                    <div className="flex gap-1">
                      <Botao variante="fantasma" tamanho="sm" icone={<KeyRound className="size-4" />} onClick={() => setEdicao({ modo: "senha", m })}>
                        Senha
                      </Botao>
                      <Botao variante={m.ativo ? "perigo" : "secundario"} tamanho="sm" carregando={mudando === m.id} onClick={() => alternar(m)}>
                        {m.ativo ? "Desativar" : "Reativar"}
                      </Botao>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
      <p className="mt-3 text-xs text-suave">Administradores da loja são cadastrados e alterados pela PRODIGY.</p>

      <Modal
        aberto={!!edicao}
        aoFechar={() => setEdicao(null)}
        titulo={edicao?.modo === "senha" ? `Nova senha de ${edicao.m.nome}` : "Novo conferente"}
      >
        {edicao && (
          <Formulario
            key={edicao.modo === "senha" ? edicao.m.id : "novo"}
            edicao={edicao}
            aoFechar={() => setEdicao(null)}
            aoSalvar={() => {
              setEdicao(null);
              equipe.recarregar();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function Formulario({ edicao, aoSalvar, aoFechar }: { edicao: Edicao; aoSalvar: () => void; aoFechar: () => void }) {
  const [login, setLogin] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (edicao.modo === "novo") {
        await chamarUsuariosLoja({ acao: "criar", login, nome, senha });
        toast.success(`Conferente ${login} criado`);
      } else {
        await chamarUsuariosLoja({ acao: "atualizar", id: edicao.m.id, senha });
        toast.success(`Senha de ${edicao.m.nome} redefinida`);
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
        <>
          <Campo
            rotulo="Login"
            required
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s/g, ""))}
            ajuda="Usado para entrar. Letras minúsculas, números, ponto ou hífen. Dica: comece pela loja (ex.: c3.maria)."
            pattern="[a-z0-9._\-]{3,40}"
          />
          <Campo rotulo="Nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
        </>
      )}
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
      {erro && <AvisoErro>{erro}</AvisoErro>}
      <div className="flex justify-end gap-2 pt-2">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao type="submit" carregando={salvando}>
          {edicao.modo === "novo" ? "Criar conferente" : "Redefinir senha"}
        </Botao>
      </div>
    </form>
  );
}
