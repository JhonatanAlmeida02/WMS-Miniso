// Administração dos usuários internos da PRODIGY.
// Criar usuário e trocar senha exigem a chave de serviço do Supabase, que não
// pode ir para o navegador; por isso essa parte roda aqui.
// Sem dependências externas: fala direto com as APIs do Auth e do banco.
//
// Quem pode chamar (docs/PERFIS_E_PERMISSOES.md):
//   * owner: gerencia todos, inclusive administradores (criar ou promover);
//   * administrador: gerencia supervisores, operadores e visualizadores.
// O papel "owner" não é dado por aqui; o banco garante que sempre exista um.
//
// POST { acao: "criar", login, nome, senha, papel, cargo?, escopo?, lojas? }
// POST { acao: "atualizar", id, nome?, papel?, cargo?, ativo?, senha?, escopo?, lojas? }
//   escopo/lojas só para papel "visualizador": escopo "lojas" (com a lista de
//   ids em lojas) ou "global_miniso". O escopo é sempre explícito.

const DOMINIO_LOGIN = "usuarios.prodigy-wms.local";
const PAPEIS_ADMIN = ["supervisor", "operador", "visualizador"];
const PAPEIS_OWNER = ["administrador", ...PAPEIS_ADMIN];
const ESCOPOS = ["lojas", "global_miniso"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function api(caminho: string, init: RequestInit & { chave?: string; token?: string } = {}) {
  const { chave = SERVICO, token = SERVICO, ...resto } = init;
  const r = await fetch(`${URL_BASE}${caminho}`, {
    ...resto,
    headers: {
      apikey: chave,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(resto.headers ?? {}),
    },
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

  // Quem está chamando? O perfil vem do banco, nunca do pedido.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return resposta(401, { erro: "Faça login novamente" });
  const eu = await api("/auth/v1/user", { chave: ANON, token });
  const meuId = (eu.corpo as Record<string, unknown> | null)?.id as string | undefined;
  if (!eu.ok || !meuId) return resposta(401, { erro: "Faça login novamente" });

  const me = await api(`/rest/v1/perfis?select=papel,ativo,loja_id&id=eq.${meuId}`);
  const meu = Array.isArray(me.corpo) ? me.corpo[0] : null;
  if (!meu || meu.ativo !== true || meu.loja_id != null || !["owner", "administrador"].includes(String(meu.papel))) {
    return resposta(403, { erro: "Apenas Owner ou Administrador" });
  }
  const souOwner = meu.papel === "owner";
  const papeisPermitidos = souOwner ? PAPEIS_OWNER : PAPEIS_ADMIN;

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "Requisição inválida" });
  }
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  // Escopo do visualizador: devolve { escopo, lojas } ou uma mensagem de erro
  function lerEscopo(): { escopo: string; lojas: number[] | null } | string {
    const escopo = texto(corpo.escopo);
    if (!ESCOPOS.includes(escopo)) return "Escolha o escopo do visualizador: por loja ou Global MINISO";
    if (escopo === "global_miniso") return { escopo, lojas: [] };
    if (corpo.lojas === undefined) return { escopo, lojas: null };
    if (!Array.isArray(corpo.lojas) || !corpo.lojas.every((x) => Number.isInteger(x) && (x as number) > 0)) {
      return "Lojas inválidas";
    }
    return { escopo, lojas: [...new Set(corpo.lojas as number[])] };
  }

  async function gravarLojas(usuario: string, lojas: number[]) {
    const apaga = await api(`/rest/v1/visualizador_lojas?usuario_id=eq.${usuario}`, { method: "DELETE" });
    if (!apaga.ok) return msgErro(apaga.corpo, "Não foi possível salvar as lojas");
    if (!lojas.length) return null;
    const grava = await api("/rest/v1/visualizador_lojas", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(lojas.map((loja_id) => ({ usuario_id: usuario, loja_id, criado_por: meuId }))),
    });
    return grava.ok ? null : msgErro(grava.corpo, "Não foi possível salvar as lojas");
  }

  if (corpo.acao === "criar") {
    const login = texto(corpo.login).toLowerCase();
    const nome = texto(corpo.nome);
    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    const papel = texto(corpo.papel) || "operador";
    const cargo = texto(corpo.cargo) || null;

    if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
      return resposta(400, { erro: "Login deve ter de 3 a 40 letras minúsculas, números, ponto, hífen ou _" });
    }
    if (!nome) return resposta(400, { erro: "Informe o nome" });
    if (senha.length < 6) return resposta(400, { erro: "A senha precisa ter pelo menos 6 caracteres" });
    if (!papeisPermitidos.includes(papel)) {
      return resposta(403, { erro: papel === "administrador" ? "Só o Owner cria administradores" : "Perfil inválido" });
    }
    let escopo: { escopo: string; lojas: number[] | null } | null = null;
    if (papel === "visualizador") {
      const e = lerEscopo();
      if (typeof e === "string") return resposta(400, { erro: e });
      escopo = e;
    }

    const existe = await api(`/rest/v1/perfis?select=id&login=eq.${encodeURIComponent(login)}`);
    if (Array.isArray(existe.corpo) && existe.corpo.length) {
      return resposta(409, { erro: "Já existe um usuário com esse login" });
    }

    const criado = await api("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: `${login}@${DOMINIO_LOGIN}`,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      }),
    });
    const novoId = (criado.corpo as Record<string, unknown> | null)?.id as string | undefined;
    if (!criado.ok || !novoId) return resposta(400, { erro: msgErro(criado.corpo, "Não foi possível criar o usuário") });

    const perfil = await api("/rest/v1/perfis", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: novoId, login, nome, papel, cargo, escopo_visualizador: escopo?.escopo ?? null }),
    });
    let falha = perfil.ok ? null : msgErro(perfil.corpo, "Não foi possível criar o perfil");
    if (!falha && escopo?.escopo === "lojas" && escopo.lojas?.length) falha = await gravarLojas(novoId, escopo.lojas);
    if (falha) {
      // Desfaz tudo: o perfil sai junto com o usuário do Auth
      await api(`/auth/v1/admin/users/${novoId}`, { method: "DELETE" });
      return resposta(400, { erro: falha });
    }
    return resposta(200, { id: novoId });
  }

  if (corpo.acao === "atualizar") {
    const id = texto(corpo.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta(400, { erro: "Usuário não informado" });
    const proprio = id === meuId;

    const alvoResp = await api(`/rest/v1/perfis?select=papel,loja_id&id=eq.${id}`);
    const alvo = Array.isArray(alvoResp.corpo) ? alvoResp.corpo[0] : null;
    if (!alvo || alvo.loja_id != null) return resposta(404, { erro: "Usuário não encontrado" });
    const papelAtual = String(alvo.papel);
    // Administrador não mexe em owner nem em outro administrador
    if (!souOwner && ["owner", "administrador"].includes(papelAtual) && !proprio) {
      return resposta(403, { erro: "Só o Owner altera administradores" });
    }
    if (papelAtual === "owner" && !proprio) return resposta(403, { erro: "A conta Owner só é alterada por ela mesma" });

    const mudancas: Record<string, unknown> = {};
    if (corpo.nome !== undefined) {
      if (!texto(corpo.nome)) return resposta(400, { erro: "Informe o nome" });
      mudancas.nome = texto(corpo.nome);
    }
    if (corpo.cargo !== undefined) mudancas.cargo = texto(corpo.cargo) || null;

    let papelNovo = papelAtual;
    if (corpo.papel !== undefined && texto(corpo.papel) !== papelAtual) {
      papelNovo = texto(corpo.papel);
      if (proprio) return resposta(400, { erro: "Você não pode mudar o seu próprio perfil" });
      if (!papeisPermitidos.includes(papelNovo)) {
        return resposta(403, { erro: papelNovo === "administrador" ? "Só o Owner promove administradores" : "Perfil inválido" });
      }
      mudancas.papel = papelNovo;
      if (papelNovo !== "visualizador") mudancas.escopo_visualizador = null;
    }
    let lojasNovas: number[] | null = null;
    if (papelNovo === "visualizador" && (corpo.escopo !== undefined || mudancas.papel)) {
      const e = lerEscopo();
      if (typeof e === "string") return resposta(400, { erro: e });
      mudancas.escopo_visualizador = e.escopo;
      lojasNovas = e.escopo === "global_miniso" ? [] : e.lojas;
    }

    if (corpo.ativo !== undefined) {
      if (proprio && corpo.ativo === false) {
        return resposta(400, { erro: "Você não pode desativar o seu próprio usuário" });
      }
      mudancas.ativo = corpo.ativo === true;
    }

    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    if (senha && senha.length < 6) return resposta(400, { erro: "A senha precisa ter pelo menos 6 caracteres" });

    // Primeiro o perfil (o banco recusa o que quebra as regras, como ficar
    // sem owner); depois o bloqueio/senha no Auth.
    if (Object.keys(mudancas).length > 0) {
      const r = await api(`/rest/v1/perfis?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(mudancas),
      });
      if (!r.ok) return resposta(400, { erro: msgErro(r.corpo, "Não foi possível salvar") });
    }
    if (lojasNovas) {
      const falha = await gravarLojas(id, lojasNovas);
      if (falha) return resposta(400, { erro: falha });
    }
    if (senha || corpo.ativo !== undefined) {
      const r = await api(`/auth/v1/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...(senha ? { password: senha } : {}),
          // Desativado = bloqueado no login também, não só nas telas
          ...(corpo.ativo !== undefined ? { ban_duration: corpo.ativo ? "none" : "876000h" } : {}),
        }),
      });
      if (!r.ok) return resposta(400, { erro: msgErro(r.corpo, "Não foi possível atualizar o acesso") });
    }
    return resposta(200, { ok: true });
  }

  return resposta(400, { erro: "Ação desconhecida" });
});
