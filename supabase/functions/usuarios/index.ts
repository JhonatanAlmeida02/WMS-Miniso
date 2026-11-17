// Administração de usuários do WMS (só supervisor).
// Criar usuário e trocar senha exigem a chave de serviço do Supabase, que não
// pode ir para o navegador; por isso essa parte roda aqui.
// Sem dependências externas: fala direto com as APIs do Auth e do banco.
//
// POST { acao: "criar", login, nome, senha, papel, cargo?, loja_id? }
// POST { acao: "atualizar", id, nome?, papel?, cargo?, ativo?, senha?, loja_id? }
//
// loja_id: o operador vira administrador daquela loja (módulo das lojas).
// Só vale para operador; tirar a loja de alguém é recusado pelo banco
// (para encerrar o acesso, desative o usuário).

const DOMINIO_LOGIN = "usuarios.prodigy-wms.local";
const PAPEIS = ["supervisor", "operador"];

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

  // Quem está chamando?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return resposta(401, { erro: "Faça login novamente" });
  const eu = await api("/auth/v1/user", { chave: ANON, token });
  const meuId = (eu.corpo as Record<string, unknown> | null)?.id as string | undefined;
  if (!eu.ok || !meuId) return resposta(401, { erro: "Faça login novamente" });

  const sup = await api("/rest/v1/rpc/eh_supervisor", { method: "POST", chave: ANON, token, body: "{}" });
  if (!sup.ok || sup.corpo !== (true as unknown)) return resposta(403, { erro: "Apenas supervisores" });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return resposta(400, { erro: "Requisição inválida" });
  }
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // undefined = não mexe; número inteiro positivo = loja escolhida
  const lojaInformada = corpo.loja_id !== undefined && corpo.loja_id !== null;
  const lojaId = Number(corpo.loja_id);
  if (lojaInformada && !(Number.isInteger(lojaId) && lojaId > 0)) return resposta(400, { erro: "Loja inválida" });

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
    if (!PAPEIS.includes(papel)) return resposta(400, { erro: "Perfil inválido" });
    if (lojaInformada && papel !== "operador") return resposta(400, { erro: "Só operador pode ser vinculado a uma loja" });

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
      body: JSON.stringify({ id: novoId, login, nome, papel, cargo, ...(lojaInformada ? { loja_id: lojaId } : {}) }),
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
    const proprio = id === meuId;

    const mudancas: Record<string, unknown> = {};
    if (corpo.nome !== undefined) {
      if (!texto(corpo.nome)) return resposta(400, { erro: "Informe o nome" });
      mudancas.nome = texto(corpo.nome);
    }
    if (corpo.cargo !== undefined) mudancas.cargo = texto(corpo.cargo) || null;
    if (corpo.papel !== undefined) {
      if (!PAPEIS.includes(texto(corpo.papel))) return resposta(400, { erro: "Perfil inválido" });
      if (proprio && corpo.papel !== "supervisor") {
        return resposta(400, { erro: "Você não pode tirar o seu próprio acesso de supervisor" });
      }
      mudancas.papel = corpo.papel;
    }
    if (lojaInformada) {
      if (proprio) return resposta(400, { erro: "Você não pode se vincular a uma loja" });
      mudancas.loja_id = lojaId;
    }
    if (corpo.ativo !== undefined) {
      if (proprio && corpo.ativo === false) {
        return resposta(400, { erro: "Você não pode desativar o seu próprio usuário" });
      }
      mudancas.ativo = corpo.ativo === true;
    }

    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    if (senha && senha.length < 6) return resposta(400, { erro: "A senha precisa ter pelo menos 6 caracteres" });

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
    if (Object.keys(mudancas).length > 0) {
      const r = await api(`/rest/v1/perfis?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(mudancas),
      });
      if (!r.ok) return resposta(400, { erro: msgErro(r.corpo, "Não foi possível salvar") });
    }
    return resposta(200, { ok: true });
  }

  return resposta(400, { erro: "Ação desconhecida" });
});
