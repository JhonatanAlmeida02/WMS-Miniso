import { test, expect, devices, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { mkdirSync } from "node:fs";

// Fluxo completo: supervisor cria a equipe, importa a planilha, distribui,
// ativa; operador bipa no celular; supervisor acompanha e confere.
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICO, { auth: { persistSession: false } });
const sufixo = Date.now().toString(36).slice(-5);
const PASTA = path.resolve("test-results/telas");
mkdirSync(PASTA, { recursive: true });

const SUP = { login: `sup.${sufixo}`, nome: "Jhonatan Almeida", senha: "prodigy123" };
const OPS = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Elisa Prado"].map((nome, i) => ({
  nome,
  login: `${nome.split(" ")[0].toLowerCase()}.${sufixo}`,
  senha: `op${i + 1}senha`,
}));
const CODIGO = `RM-${sufixo.toUpperCase()}`;

async function foto(page: Page, nome: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`), fullPage: true });
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${SUP.login}@usuarios.prodigy-wms.local`,
    password: SUP.senha,
    email_confirm: true,
  });
  if (error) throw error;
  const r = await admin.from("perfis").insert({ id: data.user.id, login: SUP.login, nome: SUP.nome, papel: "supervisor", cargo: "Coordenador de logística" });
  if (r.error) throw r.error;
});

test("fluxo completo do WMS", async ({ page, browser }) => {
  // Login
  await page.goto("/login");
  await foto(page, "01-login");
  await entrar(page, SUP.login, "senha-errada");
  await expect(page.getByRole("alert")).toContainText("Login ou senha incorretos");
  await entrar(page, SUP.login, SUP.senha);
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // Equipe: 5 operadores pela tela Usuários (Edge Function)
  await page.getByRole("link", { name: "Usuários" }).click();
  for (const op of OPS) {
    await page.getByRole("button", { name: "Novo usuário" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Login").fill(op.login);
    await dlg.getByLabel("Nome").fill(op.nome);
    await dlg.getByLabel("Cargo (opcional)").fill("Separador");
    await dlg.getByLabel("Senha").fill(op.senha);
    await dlg.getByRole("button", { name: "Criar usuário" }).click();
    await expect(page.getByRole("cell", { name: op.login, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await foto(page, "07-usuarios");

  // Nova remessa: prévia e importação
  await page.getByRole("link", { name: "Remessas" }).click();
  await page.getByRole("link", { name: "Nova remessa" }).first().click();
  await page.getByLabel("Escolher planilha").setInputFiles(path.resolve("tests/fixtures/remessa-exemplo.xlsx"));
  await expect(page.getByText("Pedidos da planilha")).toBeVisible();
  await page.getByLabel("Código da remessa").fill(CODIGO);
  await page.getByLabel("Data de chegada").fill("2026-11-12");
  await page.getByLabel("Total de caixas").fill("48");
  await foto(page, "03-nova-remessa-previa");
  await page.getByRole("button", { name: "Importar remessa" }).click();
  await expect(page.getByRole("heading", { name: `Remessa ${CODIGO}` })).toBeVisible();

  // Lojas: numerar para a ordem de separação
  // (só as lojas da planilha de exemplo, sem mexer nas outras do banco)
  const { data: lojas } = await admin.from("lojas").select("id,nome").like("nome", "Loja %").order("nome");
  for (const [i, l] of (lojas ?? []).entries()) await admin.from("lojas").update({ numero: 900 + i }).eq("id", l.id);

  // Distribuição automática entre os operadores
  await page.getByRole("link", { name: "Distribuir" }).click();
  await expect(page.getByRole("heading", { name: "Distribuição" })).toBeVisible();
  await page.getByRole("button", { name: "Dividir automaticamente" }).click();
  await foto(page, "04-distribuicao");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(/Operadores atribuídos/)).toBeVisible();

  // Ativar
  const { data: rem } = await admin.from("remessas").select("id").eq("codigo", CODIGO).single();
  await page.goto(`/remessas/${rem!.id}`);
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText("Remessa ativada")).toBeVisible();

  // Operador no celular
  const op = OPS[0];
  const { data: perfilOp } = await admin.from("perfis").select("id").eq("login", op.login).single();
  const { data: itensOp } = await admin
    .from("v_itens")
    .select("gtin,qtd_pedido,loja_numero,loja_nome")
    .eq("remessa_id", rem!.id)
    .eq("operador_id", perfilOp!.id)
    .order("loja_numero");
  const gtin = itensOp![0].gtin;
  const lojaEsperada = itensOp!.filter((i) => i.gtin === gtin)[0];

  const celular = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:5180" });
  const cel = await celular.newPage();
  await entrar(cel, op.login, op.senha);
  await expect(cel.getByText("Bipe o produto")).toBeVisible();
  await foto(cel, "05-operador-inicio");

  // GTIN que não é dele
  await cel.getByLabel("Bipe ou digite o GTIN").fill("0000000000000");
  await cel.keyboard.press("Enter");
  await expect(cel.getByText(/não está em nenhum pedido seu/)).toBeVisible();

  // Bip normal: abre o destino, confirma com Enter
  await cel.getByLabel("Bipe ou digite o GTIN").fill(gtin);
  await cel.keyboard.press("Enter");
  await expect(cel.getByText("Leve para a loja")).toBeVisible();
  await expect(cel.getByText(lojaEsperada.loja_nome).first()).toBeVisible();
  await foto(cel, "06-operador-bip");
  await cel.keyboard.press("Enter");
  await expect(cel.getByText("Registrado")).toBeVisible();

  // Quantidade acima do pedido é bloqueada
  await cel.getByLabel("Bipe ou digite o GTIN").fill(gtin);
  await cel.keyboard.press("Enter");
  await cel.getByLabel("Quantidade", { exact: true }).fill("999");
  await expect(cel.getByRole("button", { name: "Confirmar", exact: true })).toBeDisabled();
  await cel.getByRole("button", { name: "Cancelar" }).click();

  // Leitor sem Enter: os dígitos chegam rápido e a busca sai sozinha
  await cel.getByLabel("Bipe ou digite o GTIN").pressSequentially(gtin, { delay: 5 });
  await expect(cel.getByText("Leve para a loja")).toBeVisible();
  await expect(cel.getByText("Total da loja")).toBeVisible();
  await cel.getByRole("button", { name: "Cancelar" }).click();
  await expect(cel.getByRole("region", { name: "Últimos bips" }).getByRole("listitem")).toHaveCount(1);

  // Modo rápido: 3 bips seguidos
  await cel.getByTitle(/Modo rápido/).click();
  for (let i = 0; i < 3; i++) {
    await cel.getByLabel("Bipe ou digite o GTIN").fill(itensOp![1].gtin);
    await cel.keyboard.press("Enter");
    await expect(cel.getByText("Leve para a loja")).toBeVisible();
    await cel.waitForTimeout(300);
  }
  await foto(cel, "06b-operador-modo-rapido");

  // Outros operadores bipam via API, para o painel ter movimento
  for (const outro of OPS.slice(1)) {
    const c = createClient(URL, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: `${outro.login}@usuarios.prodigy-wms.local`, password: outro.senha });
    const { data: p } = await admin.from("perfis").select("id").eq("login", outro.login).single();
    const { data: itens } = await admin.from("v_itens").select("id,qtd_pedido").eq("remessa_id", rem!.id).eq("operador_id", p!.id).limit(8);
    for (const it of itens ?? []) {
      await c.rpc("registrar_bip", { p_item_id: it.id, p_qtd: Math.max(1, it.qtd_pedido - (it.id % 3 === 0 ? 1 : 0)) });
    }
  }

  // Painel atualiza sozinho
  await page.getByRole("link", { name: "Painel" }).click();
  await expect(page.getByRole("heading", { name: "Bips recentes" })).toBeVisible();
  await expect(page.getByText(`Remessa ${CODIGO}`)).toBeVisible();
  await foto(page, "02-painel");

  await page.getByRole("link", { name: "Conferência" }).click();
  await expect(page.getByText("Com divergência")).toBeVisible();
  await page.locator("tbody tr").first().click();
  await foto(page, "08-conferencia");

  await page.getByRole("link", { name: "Log de bips" }).click();
  await expect(page.getByRole("cell", { name: "Entrada" }).first()).toBeVisible();
  await foto(page, "09-log-bips");

  await page.goto(`/remessas/${rem!.id}`);
  await expect(page.getByText("Pedidos completos")).toBeVisible();
  await foto(page, "10-remessa-detalhe");

  // Estatísticas
  await page.getByRole("link", { name: "Estatísticas" }).click();
  await expect(page.getByRole("heading", { name: "Produtividade por operador" })).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(OPS[0].nome) })).toBeVisible();
  await foto(page, "12-estatisticas");

  // Conferência física: sem atribuição, o operador não vê a loja
  await cel.goto("/conferir");
  await expect(cel.getByText("Nenhuma loja para você conferir")).toBeVisible();

  // Supervisor atribui a conferência da loja ao operador
  await page.getByRole("link", { name: "Conferência" }).click();
  await page.getByRole("tab", { name: "Conferência física" }).click();
  await page.getByLabel(`Conferente da loja ${lojaEsperada.loja_nome}`).selectOption(perfilOp!.id);
  await expect(page.getByText(`Conferente de ${lojaEsperada.loja_nome} atualizado`)).toBeVisible();

  // O operador rebipa a caixa da loja
  await cel.reload();
  await cel.getByRole("button", { name: new RegExp(lojaEsperada.loja_nome) }).click();
  await expect(cel.getByText("Bipe os produtos da caixa")).toBeVisible();
  await cel.getByLabel("Bipe o produto para conferir").fill(gtin);
  await cel.keyboard.press("Enter");
  await expect(cel.getByText(/Conferindo|Produto completo/)).toBeVisible();
  await cel.getByLabel("Bipe o produto para conferir").fill("7890000000999");
  await cel.keyboard.press("Enter");
  await expect(cel.getByText("Este produto não é desta loja")).toBeVisible();
  await foto(cel, "13-conferir");
  await cel.getByRole("button", { name: "Finalizar", exact: true }).click();
  await expect(cel.getByRole("dialog").getByText("De outra loja")).toBeVisible();
  await cel.getByRole("button", { name: "Finalizar conferência" }).click();
  await expect(cel.getByText("Resultado da conferência")).toBeVisible();

  // Supervisor vê o resultado na aba Conferência física (atualiza sozinho)
  await expect(page.getByText(/\d+ divergências?/).first()).toBeVisible({ timeout: 20_000 });
  await foto(page, "14-conferencia-fisica");

  // Celular do supervisor (menu)
  const celSup = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:5180" });
  const cs = await celSup.newPage();
  await entrar(cs, SUP.login, SUP.senha);
  await expect(cs.getByRole("heading", { name: "Painel" })).toBeVisible();
  await foto(cs, "11-painel-celular");

  // Operador não acessa telas de supervisor
  await cel.goto("/painel");
  await expect(cel).toHaveURL(/\/separacao/);

  await celular.close();
  await celSup.close();
});
