import { useEffect, useRef } from "react";

/**
 * Reconhece a leitura de um leitor de código de barras: ele "digita" o código
 * inteiro em poucos milissegundos. Assim a busca sai sozinha, mesmo que o
 * leitor não mande Enter; quem digita à mão confirma com Enter.
 */
export function useLeitor(aoLer: (codigo: string) => void) {
  const inicio = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    /** Chame no onChange com o valor novo. */
    digitou(valor: string, anterior: string) {
      const agora = performance.now();
      if (!anterior || valor.length < anterior.length) inicio.current = agora;
      clearTimeout(timer.current);
      const limpo = valor.replace(/\s/g, "");
      if (limpo.length >= 8 && /^[0-9A-Za-z-]+$/.test(limpo)) {
        const porTecla = (agora - inicio.current) / Math.max(1, limpo.length - 1);
        if (porTecla < 35) timer.current = setTimeout(() => aoLerRef.current(limpo), 90);
      }
    },
    /** Chame no Enter, para não buscar duas vezes. */
    cancelar() {
      clearTimeout(timer.current);
    },
  };
}
