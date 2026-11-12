import logo from "../assets/logo-paths.json";

const CORES: Record<string, string> = {
  azul: "#2A7DE1",
  amarelo: "#FFB71B",
  ciano: "#00C4B3",
  navy: "#111C4E",
};

/**
 * Logotipo Prodigy em vetor, extraído do Manual de Marca.
 * "negativo" = versão de inversão (símbolo colorido + "prodigy" branco),
 * para fundo azul-marinho.
 */
export function Logo({
  variante = "cor",
  simbolo = false,
  className,
  titulo = "Prodigy",
}: {
  variante?: "cor" | "negativo";
  simbolo?: boolean;
  className?: string;
  titulo?: string;
}) {
  const paths = simbolo ? logo.paths.filter((p) => p.cor !== "navy") : logo.paths;
  const largura = simbolo ? logo.simbolo_w : logo.w;
  return (
    <svg viewBox={`0 0 ${largura} ${logo.h}`} className={className} role="img" aria-label={titulo}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.cor === "navy" && variante === "negativo" ? "#FFFFFF" : CORES[p.cor]} />
      ))}
    </svg>
  );
}

/** Curvas do "Sistema Gráfico" do manual, usadas como fundo decorativo. */
export function CurvasMarca({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 600" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M-20 420 H250 C330 420 340 300 420 300 H820" />
        <path d="M-20 450 H260 C345 450 355 330 435 330 H820" />
        <path d="M-20 480 H270 C360 480 370 360 450 360 H820" />
      </g>
      <path d="M520 0 C520 90 600 120 680 120 H820 V0 Z" fill="currentColor" opacity="0.12" />
    </svg>
  );
}
