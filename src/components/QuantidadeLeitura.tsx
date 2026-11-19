import { useEffect, useState, type FormEvent, type RefObject } from "react";
import { Check, Minus, Plus, X, Zap } from "lucide-react";
import { cx } from "./ui";

/** Modo rápido (cada bip conta 1) lembrado por aparelho, como na separação. */
export function useModoRapido(chave: string) {
  const [ligado, setLigado] = useState(() => {
    try {
      return localStorage.getItem(chave) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(chave, ligado ? "1" : "0");
    } catch {
      /* sem armazenamento */
    }
  }, [chave, ligado]);
  return [ligado, setLigado] as const;
}

/** Caixa "Modo rápido" ao lado do campo de bip (mesma da separação). */
export function ChaveModoRapido({ ligado, aoMudar }: { ligado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <label
      className={cx(
        "flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm select-none",
        ligado ? "border-amarelo bg-amarelo-claro text-navy" : "border-borda text-suave",
      )}
      title="Modo rápido: cada bip já conta 1 unidade, sem perguntar a quantidade"
    >
      <input type="checkbox" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} className="size-5 accent-azul" />
      <Zap className="size-4 text-amarelo" aria-hidden />
      <span className="hidden font-medium sm:inline">Modo rápido</span>
    </label>
  );
}

/** Quantidade digitada: inteiro de 1 a 9999. */
export const qtdValida = (qtd: string) => /^\d{1,4}$/.test(qtd.trim()) && Number(qtd) >= 1;

/**
 * Depois do bip: mostra o produto e pede a quantidade, como na separação.
 * Enter confirma; bipar outro produto com o campo em foco troca de produto.
 */
export function QuantidadeLeitura({
  aviso,
  tom = "normal",
  produto,
  gtin,
  numeros,
  qtd,
  setQtd,
  falta,
  campoRef,
  aoDigitar,
  gravando,
  aoConfirmar,
  aoCancelar,
  textoConfirmar = "Confirmar",
}: {
  aviso: string;
  tom?: "normal" | "aviso" | "erro";
  produto: string;
  gtin: string;
  numeros: { rotulo: string; valor: number }[];
  qtd: string;
  setQtd: (v: string) => void;
  /** Quanto ainda falta (mostra o atalho "Tudo"); 0 ou menos esconde. */
  falta: number;
  campoRef: RefObject<HTMLInputElement | null>;
  /** Para reconhecer um novo bip no campo de quantidade. */
  aoDigitar: (novo: string, anterior: string) => void;
  gravando: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  textoConfirmar?: string;
}) {
  const valida = qtdValida(qtd);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        aoConfirmar();
      }}
      className="flex flex-1 flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-borda"
    >
      <div
        className={cx(
          "flex flex-1 flex-col items-center justify-center gap-[clamp(0.5rem,2vh,1.25rem)] px-4 py-[clamp(0.75rem,3vh,2rem)] text-center",
          tom === "erro" ? "bg-erro text-white" : tom === "aviso" ? "bg-amarelo text-navy" : "bg-navy text-white",
        )}
        aria-live="assertive"
      >
        <p className={cx("text-xs font-semibold tracking-[0.2em] uppercase sm:text-base", tom === "normal" ? "text-amarelo" : "opacity-80")}>{aviso}</p>
        <p className="line-clamp-2 max-w-3xl text-[length:clamp(1.25rem,min(4vh,6vw),2.5rem)] leading-tight font-semibold">{produto}</p>
        <p className="tabular text-sm opacity-80">GTIN {gtin}</p>
        {numeros.length > 0 && (
          <div className={cx("flex items-stretch divide-x rounded-2xl", tom === "aviso" ? "divide-navy/15 bg-navy/8" : "divide-white/15 bg-white/8")}>
            {numeros.map((n) => (
              <div key={n.rotulo} className="px-[clamp(0.75rem,3vw,1.75rem)] py-2">
                <p className="text-xs font-medium tracking-wide uppercase opacity-75">{n.rotulo}</p>
                <p className="tabular text-[length:clamp(1.5rem,min(5vh,7vw),2.75rem)] leading-tight font-semibold">{n.valor}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 p-3 sm:p-5">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setQtd(String(Math.max(1, (Number(qtd) || 0) - 1)))}
            className="grid w-12 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo sm:w-14"
            aria-label="Diminuir"
          >
            <Minus className="size-5" />
          </button>
          <label htmlFor="campo-qtd-conferencia" className="sr-only">
            Quantidade
          </label>
          <input
            id="campo-qtd-conferencia"
            ref={campoRef}
            value={qtd}
            onChange={(e) => {
              // O "1" já vem selecionado: o primeiro dígito começa a contagem do leitor
              aoDigitar(e.target.value, e.target.value.length <= 1 ? "" : qtd);
              setQtd(e.target.value.replace(/\D/g, ""));
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            className={cx(
              "tabular h-14 w-28 min-w-0 shrink-0 rounded-xl border-2 text-center text-3xl font-semibold focus:outline-none sm:w-44",
              valida ? "border-borda focus:border-azul" : "border-erro text-erro",
            )}
          />
          <button
            type="button"
            onClick={() => setQtd(String(Math.min(9999, (Number(qtd) || 0) + 1)))}
            className="grid w-12 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo sm:w-14"
            aria-label="Aumentar"
          >
            <Plus className="size-5" />
          </button>
          <button
            type="submit"
            disabled={!valida || gravando}
            className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ciano px-2 text-base font-semibold whitespace-nowrap sm:gap-2 sm:text-lg text-navy transition-colors hover:bg-[#00b2a3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="size-5 shrink-0 sm:size-6" aria-hidden />
            {textoConfirmar}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" onClick={aoCancelar} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-suave hover:bg-fundo">
            <X className="size-4" /> Cancelar
          </button>
          {falta > 1 && (
            <button type="button" onClick={() => setQtd(String(Math.min(9999, falta)))} className="rounded-lg px-3 py-1.5 font-medium text-navy hover:bg-fundo">
              Tudo ({falta})
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
