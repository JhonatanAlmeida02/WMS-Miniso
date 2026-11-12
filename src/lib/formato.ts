const numero = new Intl.NumberFormat("pt-BR");

export const fmtNum = (n: number | null | undefined) => numero.format(n ?? 0);

export function pct(parte: number, total: number) {
  if (!total) return 0;
  return Math.min(100, (parte / total) * 100);
}

export const fmtPct = (parte: number, total: number) =>
  `${pct(parte, total).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

export function fmtData(iso: string | null | undefined) {
  if (!iso) return "—";
  // datas puras (yyyy-mm-dd) não podem virar "dia anterior" por fuso
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("pt-BR");
}

export function fmtDataHora(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function tempoRelativo(iso: string | null | undefined) {
  if (!iso) return "nunca";
  const seg = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "agora";
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  return `há ${Math.floor(seg / 86400)} d`;
}

/** Mesmas regras do Power Apps: online até 5 min, inativo até 10 min. */
export function situacaoOnline(iso: string | null | undefined): "online" | "inativo" | "offline" {
  if (!iso) return "offline";
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min <= 5) return "online";
  if (min <= 10) return "inativo";
  return "offline";
}

export const nomeLoja = (nome: string, numero: number | null | undefined) =>
  numero != null ? `${String(numero).padStart(2, "0")} · ${nome}` : nome;
