import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { SeloLoja } from "./SeloLoja";
import { cx } from "./ui";

export function useSanfonas() {
  const [abertas, setAbertas] = useState<Set<number>>(() => new Set());
  return {
    aberta: (id: number) => abertas.has(id),
    alternar: (id: number) => setAbertas((atual) => { const proxima = new Set(atual); if (proxima.has(id)) proxima.delete(id); else proxima.add(id); return proxima; }),
    expandir: (ids: number[]) => setAbertas(new Set(ids)),
    recolher: () => setAbertas(new Set()),
  };
}

/** Ações ficam fora do botão de expansão: habilitar acesso não abre a sanfona. */
export function SanfonaLoja({ nome, numero, resumo, aberta, alternar, acoes, children }: {
  nome: string; numero: number | null; resumo: ReactNode; aberta: boolean; alternar: () => void; acoes?: ReactNode; children: ReactNode;
}) {
  const id = useId();
  return <section className="border-b border-borda last:border-b-0">
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <h3 className="min-w-0 flex-1">
        <button type="button" aria-expanded={aberta} aria-controls={`${id}-conteudo`} id={`${id}-botao`} onClick={alternar} className="flex w-full items-center gap-3 rounded-lg py-1 text-left hover:bg-fundo focus-visible:outline-azul">
          <ChevronDown aria-hidden className={cx("size-5 shrink-0 transition-transform motion-reduce:transition-none", !aberta && "-rotate-90")} />
          <SeloLoja nome={nome} numero={numero} className="size-9 shrink-0 text-sm" />
          <span className="min-w-0"><span className="block truncate font-semibold">{nome}</span><span className="mt-1 block text-sm font-normal text-suave">{resumo}</span></span>
        </button>
      </h3>
      {acoes && <div className="flex flex-wrap items-center gap-3 pl-8 sm:pl-0">{acoes}</div>}
    </div>
    <div id={`${id}-conteudo`} role="region" aria-labelledby={`${id}-botao`} hidden={!aberta}>{aberta && children}</div>
  </section>;
}
