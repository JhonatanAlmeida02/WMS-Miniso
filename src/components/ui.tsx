import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { LoaderCircle, X } from "lucide-react";
import type { StatusRemessa } from "../lib/tipos";
import { fmtPct, pct } from "../lib/formato";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type VarianteBotao = "primario" | "azul" | "secundario" | "fantasma" | "perigo" | "sucesso";

const VARIANTES: Record<VarianteBotao, string> = {
  primario: "bg-navy text-white hover:bg-navy-700 disabled:bg-navy/40",
  azul: "bg-azul-escuro text-white hover:bg-navy-600 disabled:bg-azul/40",
  secundario: "bg-white text-navy border border-borda hover:border-navy/30 hover:bg-azul-claro/50 disabled:opacity-50",
  fantasma: "text-navy hover:bg-navy/5 disabled:opacity-40",
  perigo: "bg-white text-erro border border-erro/30 hover:bg-erro-claro disabled:opacity-50",
  sucesso: "bg-ciano text-navy hover:bg-[#00b2a3] disabled:opacity-50",
};

export function classesBotao(variante: VarianteBotao = "primario", tamanho: "sm" | "md" | "lg" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed",
    tamanho === "sm" && "h-9 px-3 text-sm",
    tamanho === "md" && "h-11 px-4 text-[15px]",
    tamanho === "lg" && "h-14 px-6 text-lg",
    VARIANTES[variante],
  );
}

export const Botao = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variante?: VarianteBotao;
    tamanho?: "sm" | "md" | "lg";
    carregando?: boolean;
    icone?: ReactNode;
  }
>(function Botao({ variante = "primario", tamanho = "md", carregando, icone, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || carregando}
      className={cx(classesBotao(variante, tamanho), className)}
      {...rest}
    >
      {carregando ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
});

export const Campo = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { rotulo: string; ajuda?: string; erro?: string }
>(function Campo({ rotulo, ajuda, erro, className, id, ...rest }, ref) {
  const gerado = useId();
  const idFinal = id ?? gerado;
  return (
    <div className={className}>
      <label htmlFor={idFinal} className="mb-1.5 block text-sm font-medium text-navy">
        {rotulo}
      </label>
      <input
        ref={ref}
        id={idFinal}
        aria-invalid={erro ? true : undefined}
        aria-describedby={ajuda || erro ? `${idFinal}-ajuda` : undefined}
        className={cx(
          "h-11 w-full rounded-xl border bg-white px-3 text-[15px] text-navy placeholder:text-suave/70",
          "focus:border-azul focus:outline-none focus:ring-3 focus:ring-azul/20",
          erro ? "border-erro" : "border-borda",
        )}
        {...rest}
      />
      {(ajuda || erro) && (
        <p id={`${idFinal}-ajuda`} className={cx("mt-1 text-xs", erro ? "text-erro" : "text-suave")}>
          {erro ?? ajuda}
        </p>
      )}
    </div>
  );
});

export function Selecao({
  rotulo,
  className,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { rotulo?: string }) {
  const gerado = useId();
  const idFinal = id ?? gerado;
  return (
    <div className={className}>
      {rotulo && (
        <label htmlFor={idFinal} className="mb-1.5 block text-sm font-medium text-navy">
          {rotulo}
        </label>
      )}
      <select
        id={idFinal}
        className="h-11 w-full rounded-xl border border-borda bg-white px-3 text-[15px] text-navy focus:border-azul focus:outline-none focus:ring-3 focus:ring-azul/20"
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

export function Cartao({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-2xl border border-borda bg-white", className)}>{children}</section>;
}

export function Barra({ parte, total, className, cor }: { parte: number; total: number; className?: string; cor?: string }) {
  const p = pct(parte, total);
  const completo = total > 0 && parte >= total;
  return (
    <div
      className={cx("h-2 w-full overflow-hidden rounded-full bg-navy/8", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
      aria-label={`${fmtPct(parte, total)} separado`}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", cor ?? (completo ? "bg-ciano" : "bg-azul"))}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

const STATUS: Record<StatusRemessa, { texto: string; classe: string }> = {
  pendente: { texto: "Pendente", classe: "bg-amarelo-claro text-[#7a5200]" },
  ativa: { texto: "Ativa", classe: "bg-azul-claro text-azul-escuro" },
  concluida: { texto: "Concluída", classe: "bg-ciano-claro text-ciano-escuro" },
};

export function SeloStatus({ status }: { status: StatusRemessa }) {
  const s = STATUS[status];
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", s.classe)}>{s.texto}</span>;
}

export function Selo({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}>{children}</span>;
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-suave" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

export function Vazio({ icone, titulo, children }: { icone?: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icone && <div className="mb-3 text-azul">{icone}</div>}
      <p className="font-semibold text-navy">{titulo}</p>
      {children && <div className="mt-1 max-w-md text-sm text-suave">{children}</div>}
    </div>
  );
}

export function AvisoErro({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-erro/25 bg-erro-claro px-4 py-3 text-sm text-erro">
      {children}
    </div>
  );
}

export function Modal({
  aberto,
  aoFechar,
  titulo,
  children,
  largura = "max-w-lg",
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  children: ReactNode;
  largura?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-navy shadow-2xl backdrop:bg-navy/50",
        largura,
      )}
    >
      {aberto && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{titulo}</h2>
            <button
              type="button"
              onClick={aoFechar}
              className="-m-2 rounded-lg p-2 text-suave hover:bg-navy/5"
              aria-label="Fechar"
            >
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

interface PedidoConfirmacao {
  titulo: string;
  mensagem: ReactNode;
  confirmar: string;
  perigo?: boolean;
}

/** Diálogo de confirmação: const [confirmar, dialogo] = useConfirmacao(); */
export function useConfirmacao(): [(p: PedidoConfirmacao) => Promise<boolean>, ReactNode] {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { resolver: (v: boolean) => void }) | null>(null);
  const confirmar = useCallback(
    (p: PedidoConfirmacao) => new Promise<boolean>((resolver) => setPedido({ ...p, resolver })),
    [],
  );
  const fechar = (v: boolean) => {
    pedido?.resolver(v);
    setPedido(null);
  };
  const dialogo = (
    <Modal aberto={!!pedido} aoFechar={() => fechar(false)} titulo={pedido?.titulo ?? ""}>
      <div className="text-sm text-suave">{pedido?.mensagem}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Botao variante="secundario" onClick={() => fechar(false)}>
          Cancelar
        </Botao>
        <Botao variante={pedido?.perigo ? "perigo" : "primario"} onClick={() => fechar(true)} autoFocus>
          {pedido?.confirmar}
        </Botao>
      </div>
    </Modal>
  );
  return [confirmar, dialogo];
}

export function Titulo({ titulo, descricao, acoes }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}
