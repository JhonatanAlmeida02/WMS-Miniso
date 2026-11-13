import { cx } from "./ui";

/** Número da loja em destaque (ou as iniciais, se a loja não tiver número). */
export function SeloLoja({ numero, nome, className }: { numero: number | null; nome: string; className?: string }) {
  const texto =
    numero != null
      ? String(numero).padStart(2, "0")
      : nome
          .replace(/^loja\s+/i, "")
          .split(/\s+/)
          .slice(0, 2)
          .map((p) => p[0]?.toUpperCase())
          .join("");
  return (
    <span className={cx("tabular grid shrink-0 place-items-center rounded-[28%] bg-ciano font-semibold text-navy", className)} aria-hidden>
      {texto}
    </span>
  );
}
