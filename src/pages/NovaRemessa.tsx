import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { lerPlanilhaRemessa, MODELO_CSV, type ResultadoLeitura } from "../lib/planilha";
import { mensagemErro, supabase } from "../lib/supabase";
import { useConsulta } from "../lib/useConsulta";
import { fmtNum } from "../lib/formato";
import type { Loja } from "../lib/tipos";
import { AvisoErro, Botao, Campo, Cartao, Selo, Titulo, cx } from "../components/ui";

function baixarModelo() {
  const blob = new Blob(["﻿" + MODELO_CSV], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "modelo-remessa.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function NovaRemessa() {
  const navegar = useNavigate();
  const [codigo, setCodigo] = useState("");
  const [chegada, setChegada] = useState("");
  const [caixas, setCaixas] = useState("");
  const [obs, setObs] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const lojas = useConsulta<Loja[]>(() => supabase.from("lojas").select("*"), []);

  async function escolher(f: File | undefined) {
    if (!f) return;
    setArquivo(f);
    setLeitura(null);
    setErroArquivo(null);
    setLendo(true);
    try {
      const r = await lerPlanilhaRemessa(f);
      if (r.linhas.length === 0 && r.erros.length === 0) throw new Error("A planilha não tem linhas de dados.");
      setLeitura(r);
      if (!codigo) setCodigo(f.name.replace(/\.(xlsx|csv)$/i, "").slice(0, 40));
    } catch (e) {
      setErroArquivo((e as Error).message || "Não consegui ler este arquivo. Use .xlsx ou .csv.");
    } finally {
      setLendo(false);
    }
  }

  const resumo = useMemo(() => {
    if (!leitura) return null;
    const existentes = new Set((lojas.dados ?? []).map((l) => l.nome.trim().toLowerCase()));
    const pedidos = new Map<string, { loja: string; itens: number; qtd: number }>();
    for (const l of leitura.linhas) {
      const p = pedidos.get(l.pedido) ?? { loja: l.loja, itens: 0, qtd: 0 };
      p.itens += 1;
      p.qtd += l.qtd;
      pedidos.set(l.pedido, p);
    }
    const nomesLojas = [...new Set(leitura.linhas.map((l) => l.loja))];
    return {
      pedidos: [...pedidos.entries()].sort((a, b) => a[1].loja.localeCompare(b[1].loja, "pt-BR")),
      lojas: nomesLojas.length,
      lojasNovas: nomesLojas.filter((n) => !existentes.has(n.trim().toLowerCase())),
      produtos: new Set(leitura.linhas.map((l) => l.gtin)).size,
      unidades: leitura.linhas.reduce((s, l) => s + l.qtd, 0),
    };
  }, [leitura, lojas.dados]);

  const podeImportar = !!leitura && leitura.erros.length === 0 && leitura.linhas.length > 0 && codigo.trim() !== "";

  async function importar(e: FormEvent) {
    e.preventDefault();
    if (!podeImportar || !leitura) return;
    setImportando(true);
    const { data, error } = await supabase.rpc("importar_remessa", {
      p_codigo: codigo.trim(),
      p_linhas: leitura.linhas,
      p_data_chegada: chegada || null,
      p_total_caixas: caixas ? Number(caixas) : null,
      p_observacao: obs || null,
      p_arquivo_nome: arquivo?.name ?? null,
    });
    setImportando(false);
    if (error) {
      toast.error(mensagemErro(error));
      return;
    }
    toast.success(`Remessa ${codigo.trim()} importada. Agora distribua os pedidos e ative.`);
    navegar(`/remessas/${data}`);
  }

  function soltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files?.[0]);
  }

  return (
    <>
      <Link to="/remessas" className="mb-3 inline-flex items-center gap-1 text-sm text-suave hover:text-navy">
        <ArrowLeft className="size-4" /> Remessas
      </Link>
      <Titulo
        titulo="Nova remessa"
        descricao="A planilha é conferida aqui mesmo antes de gravar. Nada é salvo até você confirmar."
        acoes={
          <Botao variante="secundario" icone={<Download className="size-4" />} onClick={baixarModelo}>
            Baixar modelo
          </Botao>
        }
      />

      <form onSubmit={importar} className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Cartao className="space-y-4 self-start p-5">
          <Campo rotulo="Código da remessa" required value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={40} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Data de chegada" type="date" value={chegada} onChange={(e) => setChegada(e.target.value)} />
            <Campo
              rotulo="Total de caixas"
              type="number"
              min={0}
              inputMode="numeric"
              value={caixas}
              onChange={(e) => setCaixas(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="obs" className="mb-1.5 block text-sm font-medium">
              Observação
            </label>
            <textarea
              id="obs"
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              className="w-full rounded-xl border border-borda px-3 py-2 text-[15px] focus:border-azul focus:ring-3 focus:ring-azul/20 focus:outline-none"
            />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={soltar}
            className={cx(
              "rounded-2xl border-2 border-dashed p-5 text-center transition-colors",
              arrastando ? "border-azul bg-azul-claro" : "border-borda bg-fundo",
            )}
          >
            <FileSpreadsheet className="mx-auto size-8 text-azul" aria-hidden />
            <p className="mt-2 text-sm font-medium">{arquivo ? arquivo.name : "Arraste a planilha aqui"}</p>
            <p className="text-xs text-suave">Excel (.xlsx) ou .csv com NomePedido, Loja, Gtin, Produto e Qtdped</p>
            <input
              ref={inputArquivo}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              aria-label="Escolher planilha"
              onChange={(e) => escolher(e.target.files?.[0])}
            />
            <Botao
              variante="secundario"
              tamanho="sm"
              className="mt-3"
              carregando={lendo}
              icone={<Upload className="size-4" />}
              onClick={() => inputArquivo.current?.click()}
            >
              {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
            </Botao>
          </div>
          {erroArquivo && <AvisoErro>{erroArquivo}</AvisoErro>}

          <Botao type="submit" tamanho="lg" className="w-full" disabled={!podeImportar} carregando={importando}>
            Importar remessa
          </Botao>
          <p className="text-xs text-suave">A remessa entra como Pendente. Ela só aparece para os operadores depois que você ativar.</p>
        </Cartao>

        <div className="min-w-0 space-y-4">
          {!leitura && (
            <Cartao className="p-8 text-center text-sm text-suave">
              A prévia da planilha aparece aqui: pedidos, lojas, unidades e qualquer linha com problema.
            </Cartao>
          )}
          {leitura && resumo && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Pedidos", resumo.pedidos.length],
                  ["Lojas", resumo.lojas],
                  ["Produtos", resumo.produtos],
                  ["Unidades", resumo.unidades],
                ].map(([r, v]) => (
                  <Cartao key={r as string} className="p-4">
                    <p className="text-xs text-suave">{r}</p>
                    <p className="tabular text-2xl font-semibold">{fmtNum(v as number)}</p>
                  </Cartao>
                ))}
              </div>

              {leitura.erros.length > 0 && (
                <div role="alert" className="rounded-2xl border border-erro/25 bg-erro-claro p-4 text-sm text-erro">
                  <p className="flex items-center gap-2 font-semibold">
                    <TriangleAlert className="size-4" /> Corrija a planilha antes de importar ({leitura.erros.length})
                  </p>
                  <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {leitura.erros.slice(0, 100).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {resumo.lojasNovas.length > 0 && (
                <div className="rounded-2xl border border-amarelo/50 bg-amarelo-claro p-4 text-sm text-[#5c3d00]">
                  <p className="font-semibold">
                    {resumo.lojasNovas.length} {resumo.lojasNovas.length === 1 ? "loja nova será criada" : "lojas novas serão criadas"}
                  </p>
                  <p className="mt-1">{resumo.lojasNovas.join(", ")}</p>
                  <p className="mt-1 text-xs">Confira se não é a mesma loja escrita de outro jeito. Depois você define o número dela em Lojas.</p>
                </div>
              )}

              <Cartao className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-borda px-5 py-3">
                  <h2 className="font-semibold">Pedidos da planilha</h2>
                  <span className="text-xs text-suave">{fmtNum(leitura.linhas.length)} linhas válidas</span>
                </div>
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-fundo text-left text-xs font-semibold tracking-wide text-suave uppercase">
                      <tr>
                        <th className="px-5 py-2.5">Pedido</th>
                        <th className="px-3 py-2.5">Loja</th>
                        <th className="px-3 py-2.5 text-right">Itens</th>
                        <th className="px-5 py-2.5 text-right">Unidades</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borda">
                      {resumo.pedidos.map(([nome, p]) => (
                        <tr key={nome}>
                          <td className="px-5 py-2.5 font-medium">{nome}</td>
                          <td className="px-3 py-2.5">
                            {p.loja}
                            {resumo.lojasNovas.includes(p.loja) && <Selo className="ml-2 bg-amarelo-claro text-[#7a5200]">nova</Selo>}
                          </td>
                          <td className="tabular px-3 py-2.5 text-right">{fmtNum(p.itens)}</td>
                          <td className="tabular px-5 py-2.5 text-right">{fmtNum(p.qtd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Cartao>
            </>
          )}
        </div>
      </form>
    </>
  );
}
