import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Store } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import type { Loja } from "../lib/tipos";
import { AvisoErro, Botao, Campo, Cartao, Carregando, Modal, Titulo, Vazio } from "../components/ui";

function Formulario({ loja, aoSalvar, aoFechar }: { loja: Loja | null; aoSalvar: () => void; aoFechar: () => void }) {
  const [nome, setNome] = useState(loja?.nome ?? "");
  const [numero, setNumero] = useState(loja?.numero != null ? String(loja.numero) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    const dados = { nome: nome.trim(), numero: numero ? Number(numero) : null };
    const { error } = loja
      ? await supabase.from("lojas").update(dados).eq("id", loja.id)
      : await supabase.from("lojas").insert(dados);
    setSalvando(false);
    if (error) {
      setErro(/duplicate|unique/i.test(error.message) ? "Já existe uma loja com esse nome ou número." : mensagemErro(error));
      return;
    }
    toast.success(loja ? "Loja atualizada" : "Loja criada");
    aoSalvar();
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Campo
          rotulo="Número"
          type="number"
          min={0}
          inputMode="numeric"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
        />
        <Campo rotulo="Nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <p className="text-xs text-suave">
        O número define a ordem de separação: o bip vai primeiro para a loja de menor número. O nome precisa ser igual ao da coluna
        Loja da planilha.
      </p>
      {erro && <AvisoErro>{erro}</AvisoErro>}
      <div className="flex justify-end gap-2">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao type="submit" carregando={salvando}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

export default function Lojas() {
  const [editando, setEditando] = useState<Loja | null | "nova">(null);
  const { dados, carregando, erro, recarregar } = useConsulta<Loja[]>(
    () => supabase.from("lojas").select("*").order("numero", { ascending: true, nullsFirst: false }).order("nome"),
    [],
  );
  const semNumero = (dados ?? []).filter((l) => l.numero == null).length;

  return (
    <>
      <Titulo
        titulo="Lojas"
        descricao="Lojas novas da planilha são criadas na importação. Aqui você define o número de cada uma."
        acoes={
          <Botao icone={<Plus className="size-4" />} onClick={() => setEditando("nova")}>
            Nova loja
          </Botao>
        }
      />
      {erro && <AvisoErro>{erro}</AvisoErro>}
      {semNumero > 0 && (
        <p className="mb-4 rounded-xl bg-amarelo-claro px-4 py-3 text-sm text-[#5c3d00]">
          {semNumero} {semNumero === 1 ? "loja está" : "lojas estão"} sem número e vão para o fim da ordem de separação.
        </p>
      )}
      <Cartao className="overflow-hidden">
        {carregando && !dados ? (
          <Carregando />
        ) : (dados ?? []).length === 0 ? (
          <Vazio icone={<Store className="size-8" />} titulo="Nenhuma loja ainda">
            Elas aparecem aqui quando você importar a primeira remessa.
          </Vazio>
        ) : (
          <ul className="divide-y divide-borda">
            {(dados ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-4 px-5 py-3">
                <span className="tabular grid size-10 shrink-0 place-items-center rounded-xl bg-azul-claro font-semibold text-azul-escuro">
                  {l.numero ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{l.nome}</span>
                <Botao variante="fantasma" tamanho="sm" icone={<Pencil className="size-4" />} onClick={() => setEditando(l)}>
                  Editar
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      <Modal aberto={editando !== null} aoFechar={() => setEditando(null)} titulo={editando === "nova" ? "Nova loja" : "Editar loja"}>
        {editando !== null && (
          <Formulario
            key={editando === "nova" ? "nova" : editando.id}
            loja={editando === "nova" ? null : editando}
            aoFechar={() => setEditando(null)}
            aoSalvar={() => {
              setEditando(null);
              recarregar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
