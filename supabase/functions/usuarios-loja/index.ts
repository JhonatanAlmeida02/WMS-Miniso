// Usuários das lojas (módulo "Lojas MINISO").
// Separada da função "usuarios" (equipe do CD), que não muda.
// O usuário de loja é um "operador" com perfis.loja_id: vê só a própria loja.
//   admin_loja = true  -> administrador da loja (cadastrado pela PRODIGY)
//   admin_loja = false -> conferente da loja
//
// Quem pode chamar:
//   * supervisor PRODIGY: qualquer usuário de loja, qualquer loja;
//   * administrador da loja (ativo, com o acesso da loja ligado): só os
//     conferentes da PRÓPRIA loja. A loja vem do banco, nunca do pedido.
//
// POST { acao: "criar", login, nome, senha, loja_id?, cargo?, admin_loja? }
// POST { acao: "atualizar", id, nome?, cargo?, loja_id?, admin_loja?, ativo?, senha? }
//   (só para usuários que já são de loja; para encerrar o acesso, ativo: false)

const DOMINIO_LOGIN = "usuarios.prodigy-wms.local";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function api(caminho: string, init: RequestInit & { chave?: string; token?: string } = {}) {
  const { chave = SERVICO, token = SERVICO, ...resto } = init;
  const r = await fetch(`${URL_BASE}${caminho}`, {
    ...resto,
    headers: { apikey: chave, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(resto.headers ?? {}) },
  });
  const texto = await r.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { ok: r.ok, status: r.status, corpo: corpo as Record<string, unknown> | Record<string, unknown>[] | null };
}

function msgErro(corpo: unknown, padrao: string) {
  const c = corpo as Record<string, unknown> | null;
  const m = (c?.msg ?? c?.message ?? c?.error_description ?? c?.error) as string | undefined;
  if (m && /already been registered|already exists/i.test(m)) return "Já existe um usuário com esse login";
  if (m && /password/i.test(m) && /least|short|weak/i.test(m)) return "Senha fraca: use pelo menos 6 caracteres";
  return m || padrao;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta(405, { erro: "Método não permitido" });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return resposta(401, { erro: "Faça login novamente" });
  const eu = await api("/auth/v1/user", { chave: ANON, token });
  const meuId = (eu.corpo as Record<string, unknown> | null)?.id as string | undefined;
  if (!eu.ok || !meuId) return resposta(401, { erro: "Faça login novamente" });
  const sup = await api("/rest/v1/rpc/eh_supervisor", { method: "POST", chave: ANON, token, body: "{}" });
  const supervisor = sup.ok && sup.corpo === (true as unknown);

  // Não é supervisor: precisa ser administrador de uma loja com acesso ligado
  let minhaLoja: number | null = null;
  if (!supervisor) {
    const me = await api(`/rest/v1/perfis?select=ativo,loja_id,admin_loja&id=eq.${meuId}`);
    const p = Array.isArray(me.corpo) ? me.corpo[0] : null;
    if (!p || p.ativo !== true || p.admin_loja !== true || p.loja_id == null) {
      return resposta(403, { erro: "Apenas supervisores ou o administrador da loja" });
    }
    const l = await api(`/rest/v1/lojas?select=modulo_loja&id=eq.${p.loja_id}`);
    const loja = Array.isArray(l.corpo) ? l.corpo[0] : null;
    if (!loja || loja.modulo_loja !== true) return resposta(403, { erro: "O acesso da sua loja não está liberado" });
    minhaLoja = Number(p.loja_id);
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "Requisição inválida" });
  }
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // Administrador da loja: a loja é sempre a dele, e ele só mexe em conferentes
  if (minhaLoja !== null) {
    if (corpo.admin_loja === true) return resposta(403, { erro: "Só a PRODIGY cadastra administradores da loja" });
    if (corpo.loja_id !== undefined && corpo.loja_id !== null && Number(corpo.loja_id) !== minhaLoja) {
      return resposta(403, { erro: "Você só cadastra usuários da sua loja" });
    }
    corpo.loja_id = minhaLoja;
    delete corpo.admin_loja;
  }
  const lojaInformada = corpo.loja_id !== undefined && corpo.loja_id !== null && corpo.loja_id !== "";
  const lojaId = Number(corpo.loja_id);
  if (lojaInformada) {
    if (!(Number.isInteger(lojaId) && lojaId > 0)) return resposta(400, { erro: "Loja inválida" });
    const loja = await api(`/rest/v1/lojas?select=id&id=eq.${lojaId}`);
    if (!Array.isArray(loja.corpo) || !loja.corpo.length) return resposta(400, { erro: "Loja não encontrada" });
  }

  if (corpo.acao === "criar") {
    const login = texto(corpo.login).toLowerCase();
    const nome = texto(corpo.nome);
    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    const cargo = texto(corpo.cargo) || null;
    if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
      return resposta(400, { erro: "Login deve ter de 3 a 40 letras minúsculas, números, ponto, hífen ou _" });
    }
    if (!nome) return resposta(400, { erro: "Informe o nome" });
    if (senha.length < 6) return resposta(400, { erro: "A senha precisa ter pelo menos 6 caracteres" });
    if (!lojaInformada) return resposta(400, { erro: "Escolha a loja" });

    const existe = await api(`/rest/v1/perfis?select=id&login=eq.${encodeURIComponent(login)}`);
    if (Array.isArray(existe.corpo) && existe.corpo.length) return resposta(409, { erro: "Já existe um usuário com esse login" });

    const criado = await api("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: `${login}@${DOMINIO_LOGIN}`, password: senha, email_confirm: true, user_metadata: { nome } }),
    });
    const novoId = (criado.corpo as Record<string, unknown> | null)?.id as string | undefined;
    if (!criado.ok || !novoId) return resposta(400, { erro: msgErro(criado.corpo, "Não foi possível criar o usuário") });

    const perfil = await api("/rest/v1/perfis", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: novoId, login, nome, papel: "operador", cargo, loja_id: lojaId, admin_loja: minhaLoja === null && corpo.admin_loja !== false }),
    });
    if (!perfil.ok) {
      await api(`/auth/v1/admin/users/${novoId}`, { method: "DELETE" });
      return resposta(400, { erro: msgErro(perfil.corpo, "Não foi possível criar o perfil") });
    }
    return resposta(200, { id: novoId });
  }

  if (corpo.acao === "atualizar") {
    const id = texto(corpo.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta(400, { erro: "Usuário não informado" });
    // Esta função só mexe em usuário de loja; a equipe do CD fica na função "usuarios"
    const alvo = await api(`/rest/v1/perfis?select=id,loja_id,admin_loja&id=eq.${id}`);
    const linha = Array.isArray(alvo.corpo) ? alvo.corpo[0] : null;
    if (!linha || linha.loja_id == null) return resposta(404, { erro: "Usuário de loja não encontrado" });
    if (minhaLoja !== null) {
      // Administrador da loja: só conferentes da própria loja, e não a si mesmo
      if (Number(linha.loja_id) !== minhaLoja) return resposta(404, { erro: "Usuário de loja não encontrado" });
      if (linha.admin_loja === true || id === meuId) return resposta(403, { erro: "Só a PRODIGY altera administradores da loja" });
    }

    const mudancas: Record<string, unknown> = {};
    if (corpo.nome !== undefined) {
      if (!texto(corpo.nome)) return resposta(400, { erro: "Informe o nome" });
      mudancas.nome = texto(corpo.nome);
    }
    if (corpo.cargo !== undefined) mudancas.cargo = texto(corpo.cargo) || null;
    if (lojaInformada && minhaLoja === null) mudancas.loja_id = lojaId;
    if (corpo.admin_loja !== undefined && minhaLoja === null) mudancas.admin_loja = corpo.admin_loja === true;
    if (corpo.ativo !== undefined) mudancas.ativo = corpo.ativo === true;

    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    if (senha && senha.length < 6) return resposta(400, { erro: "A senha precisa ter pelo menos 6 caracteres" });
    if (senha || corpo.ativo !== undefined) {
      const r = await api(`/auth/v1/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...(senha ? { password: senha } : {}),
          ...(corpo.ativo !== undefined ? { ban_duration: corpo.ativo ? "none" : "876000h" } : {}),
        }),
      });
      if (!r.ok) return resposta(400, { erro: msgErro(r.corpo, "Não foi possível atualizar o acesso") });
    }
    if (Object.keys(mudancas).length > 0) {
      const r = await api(`/rest/v1/perfis?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(mudancas) });
      if (!r.ok) return resposta(400, { erro: msgErro(r.corpo, "Não foi possível salvar") });
    }
    return resposta(200, { ok: true });
  }

  return resposta(400, { erro: "Ação desconhecida" });
});
