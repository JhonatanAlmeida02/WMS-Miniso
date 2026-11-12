// Testes do banco contra um Supabase local (npx supabase start).
//   node --test tests/integracao.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICO) throw new Error("Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY");

const DOMINIO = "usuarios.prodigy-wms.local";
const sufixo = Date.now().toString(36);
const admin = createClient(URL, SERVICO, { auth: { persistSession: false } });

async function criarUsuario(login, papel) {
  const senha = "senha-teste-123";
  const { data, error } = await admin.auth.admin.createUser({
    email: `${login}@${DOMINIO}`, password: senha, email_confirm: true,
  });
  if (error) throw error;
  const { error: e2 } = await admin.from("perfis").insert({ id: data.user.id, login, nome: login, papel });
  if (e2) throw e2;
  const cliente = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e3 } = await cliente.auth.signInWithPassword({ email: `${login}@${DOMINIO}`, password: senha });
  if (e3) throw e3;
  return { id: data.user.id, cliente };
}

let sup;
const ops = [];
let remessaId;

before(async () => {
  sup = await criarUsuario(`sup-${sufixo}`, "supervisor");
  for (let i = 1; i <= 5; i++) ops.push(await criarUsuario(`op${i}-${sufixo}`, "operador"));
});

test("anônimo não lê nada", async () => {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data } = await anon.from("remessas").select("id");
  assert.equal((data ?? []).length, 0);
});

test("operador não pode importar remessa", async () => {
  const { error } = await ops[0].cliente.rpc("importar_remessa", {
    p_codigo: `X-${sufixo}`, p_linhas: [{ pedido: "1", loja: "A", gtin: "1", produto: "P", qtd: 1 }],
  });
  assert.match(error?.message ?? "", /supervisor/i);
});

test("importação valida linhas e lojas duplicadas", async () => {
  const ruim = await sup.cliente.rpc("importar_remessa", {
    p_codigo: `R-${sufixo}-ruim`,
    p_linhas: [
      { pedido: "P1", loja: "Loja A", gtin: "789", produto: "X", qtd: 2 },
      { pedido: "P1", loja: "Loja A", gtin: "789", produto: "X", qtd: 0 },
    ],
  });
  assert.match(ruim.error?.message ?? "", /Linha 2/);

  const duasLojas = await sup.cliente.rpc("importar_remessa", {
    p_codigo: `R-${sufixo}-ruim2`,
    p_linhas: [
      { pedido: "P1", loja: "Loja A", gtin: "789", produto: "X", qtd: 2 },
      { pedido: "P1", loja: "Loja B", gtin: "789", produto: "X", qtd: 2 },
    ],
  });
  assert.match(duasLojas.error?.message ?? "", /lojas diferentes/);
});

test("importa remessa, soma GTIN repetido e cria lojas", async () => {
  const linhas = [];
  for (let l = 1; l <= 5; l++) {
    linhas.push({ pedido: `PED-${l}`, loja: `Loja Teste ${sufixo} ${l}`, gtin: "7891234567890", produto: "Café 500g", qtd: 3 });
    linhas.push({ pedido: `PED-${l}`, loja: `Loja Teste ${sufixo} ${l}`, gtin: "7890000000017", produto: "Açúcar 1kg", qtd: 2 });
  }
  linhas.push({ pedido: "PED-1", loja: `Loja Teste ${sufixo} 1`, gtin: "7890000000017", produto: "Açúcar 1kg", qtd: 1 });
  const { data, error } = await sup.cliente.rpc("importar_remessa", {
    p_codigo: `R-${sufixo}`, p_linhas: linhas, p_total_caixas: 12,
  });
  assert.ifError(error);
  remessaId = data;

  const { data: rem } = await sup.cliente.from("v_remessas").select("*").eq("id", remessaId).single();
  assert.equal(rem.pedidos, 5);
  assert.equal(rem.lojas, 5);
  assert.equal(rem.itens, 10);
  assert.equal(rem.qtd_pedido, 5 * 3 + 5 * 2 + 1);
  assert.equal(rem.status, "pendente");

  const repetida = await sup.cliente.rpc("importar_remessa", { p_codigo: `r-${sufixo}`, p_linhas: linhas });
  assert.match(repetida.error?.message ?? "", /Já existe/);
});

test("distribui e ativa; operador só vê os itens dele", async () => {
  const { data: pedidos } = await sup.cliente.from("v_pedidos").select("id,nome").eq("remessa_id", remessaId).order("nome");
  // 5 pedidos, todos para o operador 1 (o mesmo GTIN em várias lojas)
  const { error } = await sup.cliente.rpc("distribuir_pedidos", {
    p_atribuicoes: pedidos.map((p) => ({ pedido_id: p.id, operador_id: ops[0].id })),
  });
  assert.ifError(error);

  const antes = await ops[0].cliente.rpc("itens_do_gtin", { p_gtin: "7891234567890" });
  assert.equal(antes.data.length, 0, "remessa pendente não aparece para bipar");

  assert.ifError((await sup.cliente.rpc("alterar_status_remessa", { p_remessa: remessaId, p_status: "ativa" })).error);

  const { data: itens } = await ops[0].cliente.rpc("itens_do_gtin", { p_gtin: " 7891234567890 " });
  assert.equal(itens.length, 5);
  assert.equal(itens.filter((i) => i.alvo).length, 1);

  const outro = await ops[1].cliente.rpc("itens_do_gtin", { p_gtin: "7891234567890" });
  assert.equal(outro.data.length, 0);
});

test("bip não passa do pedido e ajuste não fica negativo", async () => {
  const { data: itens } = await ops[0].cliente.rpc("itens_do_gtin", { p_gtin: "7891234567890" });
  const alvo = itens.find((i) => i.alvo);

  const demais = await ops[0].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: 4 });
  assert.match(demais.error?.message ?? "", /Passaria do pedido/);

  const ok = await ops[0].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: 3 });
  assert.ifError(ok.error);
  assert.equal(ok.data[0].qtd_separada, 3);

  const { data: depois } = await ops[0].cliente.rpc("itens_do_gtin", { p_gtin: "7891234567890" });
  assert.notEqual(depois.find((i) => i.alvo).item_id, alvo.item_id, "o alvo passa para a próxima loja");

  const negativo = await ops[0].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: -1, p_tipo: "entrada" });
  assert.match(negativo.error?.message ?? "", /Ajuste/);
  const estorno = await ops[0].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: -4, p_tipo: "ajuste" });
  assert.match(estorno.error?.message ?? "", /mais do que já foi separado/);
  const ajuste = await ops[0].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: -1, p_tipo: "ajuste" });
  assert.ifError(ajuste.error);
  assert.equal(ajuste.data[0].qtd_separada, 2);

  const alheio = await ops[1].cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: 1 });
  assert.match(alheio.error?.message ?? "", /não está atribuído a você/);
});

test("5 operadores bipando ao mesmo tempo não perdem nem estouram saldo", async () => {
  // Item de 3 un. do pedido PED-5. Supervisor redistribui PED-5 para todos? Não:
  // um pedido tem um operador. Simulamos 5 aparelhos do MESMO operador + supervisor,
  // e também 5 operadores em 5 pedidos diferentes ao mesmo tempo.
  const { data: pedidos } = await sup.cliente.from("v_pedidos").select("id,nome").eq("remessa_id", remessaId).order("nome");
  await sup.cliente.rpc("distribuir_pedidos", {
    p_atribuicoes: pedidos.map((p, i) => ({ pedido_id: p.id, operador_id: ops[i].id })),
  });

  // (a) cada operador bipa o açúcar do seu pedido, 1 a 1, todos em paralelo
  const porOperador = await Promise.all(ops.map(async (op) => {
    const { data } = await op.cliente.rpc("itens_do_gtin", { p_gtin: "7890000000017" });
    const alvo = data.find((i) => i.alvo);
    const r = await Promise.all(Array.from({ length: alvo.qtd_pedido + 3 }, () =>
      op.cliente.rpc("registrar_bip", { p_item_id: alvo.item_id, p_qtd: 1 })));
    return { alvo, ok: r.filter((x) => !x.error).length, recusados: r.filter((x) => x.error).length };
  }));
  for (const r of porOperador) {
    assert.equal(r.ok, r.alvo.qtd_pedido, "aceita exatamente o que falta");
    assert.equal(r.recusados, 3, "recusa o excedente");
  }

  // (b) 10 bips simultâneos no mesmo item (aparelho + supervisor), item com 3 un.
  const op5 = ops[4];
  const { data: itens } = await op5.cliente.rpc("itens_do_gtin", { p_gtin: "7891234567890" });
  const item = itens[0];
  const falta = item.qtd_pedido - item.qtd_separada;
  const r = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    (i % 2 ? sup : op5).cliente.rpc("registrar_bip", { p_item_id: item.item_id, p_qtd: 1 })));
  assert.equal(r.filter((x) => !x.error).length, falta);

  const { data: final } = await sup.cliente.from("itens_pedido").select("qtd_separada,qtd_pedido").eq("id", item.item_id).single();
  assert.equal(final.qtd_separada, final.qtd_pedido);

  // O log fecha com o saldo de todos os itens da remessa
  const { data: bips } = await sup.cliente.from("bips").select("qtd").eq("remessa_id", remessaId);
  const { data: rem } = await sup.cliente.from("v_remessas").select("qtd_separada").eq("id", remessaId).single();
  assert.equal(bips.reduce((s, b) => s + b.qtd, 0), rem.qtd_separada);
});

test("operador não altera tabelas direto", async () => {
  const { data: itens } = await sup.cliente.from("itens_pedido").select("id").limit(1);
  const upd = await ops[0].cliente.from("itens_pedido").update({ qtd_separada: 0 }).eq("id", itens[0].id).select();
  assert.equal((upd.data ?? []).length, 0);
  const ins = await ops[0].cliente.from("lojas").insert({ nome: `hack ${sufixo}` });
  assert.ok(ins.error);
  const perfil = await ops[0].cliente.from("perfis").update({ papel: "supervisor" }).eq("id", ops[0].id).select();
  assert.equal((perfil.data ?? []).length, 0);
});

test("remessa com bips não pode ser excluída; concluir funciona", async () => {
  const ex = await sup.cliente.rpc("excluir_remessa", { p_remessa: remessaId });
  assert.match(ex.error?.message ?? "", /já tem bipagens/);
  assert.ifError((await sup.cliente.rpc("alterar_status_remessa", { p_remessa: remessaId, p_status: "concluida" })).error);
  const { data } = await ops[0].cliente.rpc("itens_do_gtin", { p_gtin: "7890000000017" });
  assert.equal(data.length, 0, "remessa concluída sai da separação");
});

test("usuário desativado perde acesso", async () => {
  await admin.from("perfis").update({ ativo: false }).eq("id", ops[2].id);
  const { data } = await ops[2].cliente.from("remessas").select("id");
  assert.equal((data ?? []).length, 0);
});
