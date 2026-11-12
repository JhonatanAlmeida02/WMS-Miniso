// Teste de carga contra um Supabase local: remessa de 19 lojas e ~4.000 linhas,
// 5 operadores bipando ao mesmo tempo.
//   node tests/carga.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMINIO = "usuarios.prodigy-wms.local";
const admin = createClient(URL, SERVICO, { auth: { persistSession: false } });
const suf = Date.now().toString(36).slice(-5);

let semente = 42;
const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);

async function usuario(login, papel) {
  const { data, error } = await admin.auth.admin.createUser({ email: `${login}@${DOMINIO}`, password: "carga-123", email_confirm: true });
  if (error) throw error;
  await admin.from("perfis").insert({ id: data.user.id, login, nome: login, papel });
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: `${login}@${DOMINIO}`, password: "carga-123" });
  return { id: data.user.id, c };
}

const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)];
async function tempo(nome, fn) {
  const t = performance.now();
  const r = await fn();
  console.log(`${nome}: ${Math.round(performance.now() - t)} ms`);
  return r;
}

const sup = await usuario(`carga.sup.${suf}`, "supervisor");
const ops = [];
for (let i = 1; i <= 5; i++) ops.push(await usuario(`carga.op${i}.${suf}`, "operador"));

// 19 lojas x ~210 produtos = ~4.000 linhas
const produtos = Array.from({ length: 320 }, (_, i) => ({ gtin: String(7890000100000 + i * 7), nome: `Brinquedo ${i + 1}` }));
const linhas = [];
for (let l = 1; l <= 19; l++) {
  const escolhidos = produtos.filter(() => rnd() < 0.66);
  for (const p of escolhidos) linhas.push({ pedido: `C${suf}-${l}`, loja: `Loja Carga ${suf} ${l}`, gtin: p.gtin, produto: p.nome, qtd: 1 + Math.floor(rnd() * 12) });
}
const unidades = linhas.reduce((s, l) => s + l.qtd, 0);
console.log(`Planilha: ${linhas.length} linhas, ${unidades} unidades, payload ${(JSON.stringify(linhas).length / 1024).toFixed(0)} KB`);

const { data: remId, error: eImp } = await tempo("Importar remessa", () =>
  sup.c.rpc("importar_remessa", { p_codigo: `CARGA-${suf}`, p_linhas: linhas }));
if (eImp) throw eImp;

const { data: peds } = await sup.c.from("v_pedidos").select("id").eq("remessa_id", remId);
await tempo("Distribuir 19 pedidos", () =>
  sup.c.rpc("distribuir_pedidos", { p_atribuicoes: peds.map((p, i) => ({ pedido_id: p.id, operador_id: ops[i % 5].id })) }));
await sup.c.rpc("alterar_status_remessa", { p_remessa: remId, p_status: "ativa" });

await tempo("Painel: v_remessas", () => sup.c.from("v_remessas").select("*").eq("id", remId).single());
await tempo("Painel: v_pedidos", () => sup.c.from("v_pedidos").select("*").eq("remessa_id", remId));
const conf = await tempo("Conferência (resumo por GTIN)", () => sup.c.rpc("conferencia_remessa", { p_remessa: remId }).range(0, 999));
console.log(`  -> ${conf.data.length} produtos`);

// Cada operador bipa todos os produtos dele: busca o GTIN e confirma a quantidade inteira
// (modo normal) ou 1 a 1 nos 40 primeiros (modo rápido)
const buscas = [], bipsT = [];
let totalBips = 0, erros = 0;
const t0 = performance.now();
await Promise.all(ops.map(async (op, idx) => {
  const { data: meus } = await sup.c.from("v_itens").select("gtin").eq("remessa_id", remId).eq("operador_id", op.id).range(0, 4999);
  const gtins = [...new Set(meus.map((m) => m.gtin))];
  for (const [n, g] of gtins.entries()) {
    let t = performance.now();
    const { data: itens } = await op.c.rpc("itens_do_gtin", { p_gtin: g });
    buscas.push(performance.now() - t);
    for (const it of itens.filter((i) => i.qtd_separada < i.qtd_pedido)) {
      const rapido = n < 40;
      const vezes = rapido ? it.qtd_pedido - it.qtd_separada : 1;
      for (let v = 0; v < vezes; v++) {
        t = performance.now();
        const { error } = await op.c.rpc("registrar_bip", { p_item_id: it.item_id, p_qtd: rapido ? 1 : it.qtd_pedido - it.qtd_separada });
        bipsT.push(performance.now() - t);
        totalBips++;
        if (error) erros++;
      }
    }
  }
}));
const dur = (performance.now() - t0) / 1000;
console.log(`5 operadores: ${totalBips} bips em ${dur.toFixed(1)} s (${(totalBips / dur).toFixed(1)} bips/s), erros ${erros}`);
console.log(`  busca GTIN: p50 ${pct(buscas, 0.5).toFixed(0)} ms, p95 ${pct(buscas, 0.95).toFixed(0)} ms`);
console.log(`  registrar bip: p50 ${pct(bipsT, 0.5).toFixed(0)} ms, p95 ${pct(bipsT, 0.95).toFixed(0)} ms`);

const { data: fim } = await sup.c.from("v_remessas").select("qtd_pedido,qtd_separada").eq("id", remId).single();
console.log(`Final: ${fim.qtd_separada}/${fim.qtd_pedido} separados`);
await tempo("Conferência no fim", () => sup.c.rpc("conferencia_remessa", { p_remessa: remId }).range(0, 999));
