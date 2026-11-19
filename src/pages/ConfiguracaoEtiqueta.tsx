import { useState, type FormEvent } from "react";
import { Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Botao, Campo, Cartao, Selecao, Titulo } from "../components/ui";
import { lerConfiguracaoEtiqueta, salvarConfiguracaoEtiqueta, validarEtiqueta } from "../lib/caixaTemporaria";
import { imprimirEtiquetaCaixa } from "../lib/imprimirEtiquetaCaixa";

export default function ConfiguracaoEtiqueta() {
  const [config, setConfig] = useState(lerConfiguracaoEtiqueta);
  const [testando, setTestando] = useState(false);
  const erro = validarEtiqueta(config);
  const [w,h] = config.orientacao === "paisagem" ? [config.altura,config.largura] : [config.largura,config.altura];
  function salvar(e: FormEvent) {
    e.preventDefault();
    try { salvarConfiguracaoEtiqueta(config); toast.success("Configuração da etiqueta salva neste posto."); }
    catch (e) { toast.error((e as Error).message || "Não foi possível salvar neste navegador."); }
  }
  async function testar() {
    if (testando) return;
    setTestando(true);
    try {
      await imprimirEtiquetaCaixa({volume:1,ultima:true,loja:"TESTE",pedido:"TESTE",conferencia:0,itens:[{sku:"7890000000001",descricao:"Produto de teste — etiqueta da caixa",qtd:2}]},config);
      toast.success("Impressão de teste solicitada.");
    } catch (e) { toast.error((e as Error).message || "Não foi possível solicitar a impressão."); }
    finally { setTestando(false); }
  }
  return <>
    <Titulo titulo="Configuração de etiqueta" descricao="Ajuste a impressão das caixas da conferência neste computador e navegador." />
    <div className="grid gap-6 lg:grid-cols-2">
      <Cartao className="p-5 sm:p-6"><form onSubmit={salvar} className="space-y-5">
        <h2 className="font-semibold">Tamanho e margens</h2>
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="Largura (mm)" type="number" min={40} max={210} step="0.1" required value={Number.isNaN(config.largura) ? "" : config.largura} onChange={e => setConfig({...config,largura:e.target.valueAsNumber})} />
          <Campo rotulo="Altura (mm)" type="number" min={40} max={500} step="0.1" required value={Number.isNaN(config.altura) ? "" : config.altura} onChange={e => setConfig({...config,altura:e.target.valueAsNumber})} />
          <Campo rotulo="Margem (mm)" type="number" min={0} max={15} step="0.1" required value={Number.isNaN(config.margem) ? "" : config.margem} onChange={e => setConfig({...config,margem:e.target.valueAsNumber})} />
          <Selecao rotulo="Orientação" value={config.orientacao} onChange={e => setConfig({...config,orientacao:e.target.value as "retrato"|"paisagem"})}><option value="retrato">Retrato</option><option value="paisagem">Paisagem</option></Selecao>
        </div>
        {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
        <p className="text-sm text-suave">Use a mesma mídia nas preferências da impressora. Para imprimir sem confirmação, o posto deve usar o Edge com impressão silenciosa habilitada.</p>
        <div className="flex flex-wrap gap-3">
          <Botao type="submit" disabled={!!erro} icone={<Save className="size-4" />}>Salvar configuração</Botao>
          <Botao variante="secundario" disabled={!!erro} carregando={testando} onClick={() => void testar()} icone={<Printer className="size-4" />}>Imprimir teste</Botao>
        </div>
      </form></Cartao>
      <Cartao className="p-5 sm:p-6"><h2 className="mb-4 font-semibold">Prévia da etiqueta</h2>
        {!erro && <><p className="mb-3 text-sm text-suave">{w} × {h} mm · margem {config.margem} mm</p><div className="mx-auto max-w-72 overflow-hidden border border-dashed border-navy/30 bg-white text-navy shadow-sm" style={{aspectRatio:`${w}/${h}`,padding:`${config.margem*3}px`}}>
          <p className="text-[10px] font-semibold">PRODIGY WMS · CONFERÊNCIA</p><p className="my-3 text-3xl font-bold">Volume 1/1</p><p className="text-xs">Loja TESTE · Pedido TESTE</p><div className="mt-4 border-y border-borda py-2 text-xs"><p className="mb-2 flex justify-between font-semibold"><span>SKU / Descrição</span><span>Qtd.</span></p><p>7890000000001</p><p className="flex justify-between gap-2"><span>Produto de teste</span><strong>2</strong></p></div>
        </div><p className="mt-4 text-xs text-suave">Caixas com muitos itens podem usar mais de uma etiqueta, repetindo a identificação do volume.</p></>}
      </Cartao>
    </div>
  </>;
}
