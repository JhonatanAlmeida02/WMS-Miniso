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
        "flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm select-none",
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
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-borda"
    >
      <div className={cx("space-y-3 p-3 text-white sm:p-4", tom === "erro" ? "bg-erro" : tom === "aviso" ? "bg-[#5c3d00]" : "bg-navy")} aria-live="assertive">
        <p className={cx("text-xs font-semibold tracking-wide uppercase", tom === "erro" ? "text-white" : "text-amarelo")}>{aviso}</p>
        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className={cx("min-w-0 rounded-xl px-3 py-2.5", tom === "erro" ? "bg-white text-erro" : "bg-ciano text-navy")}>
            <p className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg">{produto}</p>
            <p className="tabular mt-1 text-xs font-medium opacity-70">GTIN {gtin}</p>
          </div>
          {numeros.length > 0 && <div className="flex items-center justify-center gap-2 sm:justify-start">
            <div className="min-w-20 rounded-xl bg-amarelo px-3 py-2 text-center text-navy">
              <p className="text-[10px] font-semibold tracking-wide uppercase">Falta</p>
              <p className="tabular text-3xl leading-tight font-bold">{Math.max(0, falta)}</p>
            </div>
            <div className="space-y-1 rounded-xl bg-white/8 px-3 py-2">
              {numeros.map(n => <p key={n.rotulo} className="flex items-center justify-between gap-3 text-xs"><span className="text-white/70">{n.rotulo}</span><strong className="tabular text-base">{n.valor}</strong></p>)}
            </div>
          </div>}
        </div>
      </div>

      <div className="shrink-0 space-y-2 p-3">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setQtd(String(Math.max(1, (Number(qtd) || 0) - 1)))}
            className="grid w-11 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo"
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
              "tabular h-11 w-20 min-w-0 shrink-0 rounded-xl border-2 text-center text-xl font-semibold focus:outline-none sm:w-28",
              valida ? "border-borda focus:border-azul" : "border-erro text-erro",
            )}
          />
          <button
            type="button"
            onClick={() => setQtd(String(Math.min(9999, (Number(qtd) || 0) + 1)))}
            className="grid w-11 shrink-0 place-items-center rounded-xl border border-borda hover:bg-fundo"
            aria-label="Aumentar"
          >
            <Plus className="size-5" />
          </button>
          <button
            type="submit"
            disabled={!valida || gravando}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ciano px-2 text-sm font-semibold whitespace-nowrap sm:gap-2 sm:text-base text-navy transition-colors hover:bg-[#00b2a3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="hidden size-5 shrink-0 sm:block" aria-hidden />
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
