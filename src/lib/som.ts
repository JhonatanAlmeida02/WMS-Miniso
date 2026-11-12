// Bipes de confirmação/erro sem arquivo de áudio (o leitor de código de barras
// costuma ser usado sem olhar para a tela).
let ctx: AudioContext | null = null;

function tocar(freqs: number[], duracao = 0.09) {
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      vol.gain.setValueAtTime(0.06, t);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duracao);
      t += duracao + 0.02;
    }
  } catch {
    /* navegador sem áudio */
  }
}

export const somOk = () => tocar([1320]);
export const somAviso = () => tocar([880, 880]);
export const somErro = () => tocar([300, 220], 0.16);

export function vibrar(padrao: number | number[]) {
  try {
    navigator.vibrate?.(padrao);
  } catch {
    /* sem vibração */
  }
}
