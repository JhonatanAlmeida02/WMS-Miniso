// Cria o primeiro supervisor (os próximos usuários são criados pela tela Usuários).
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=chave-de-servico \
//   npm run criar-supervisor -- <login> "<Nome completo>" <senha>
import { createClient } from "@supabase/supabase-js";

const DOMINIO_LOGIN = "usuarios.prodigy-wms.local";

const [login, nome, senha] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chave) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!login || !nome || !senha) {
  console.error('Uso: npm run criar-supervisor -- <login> "<Nome completo>" <senha>');
  process.exit(1);
}
if (!/^[a-z0-9._-]{3,40}$/.test(login)) {
  console.error("Login: 3 a 40 letras minúsculas, números, ponto, hífen ou _.");
  process.exit(1);
}
if (senha.length < 6) {
  console.error("A senha precisa ter pelo menos 6 caracteres.");
  process.exit(1);
}

const admin = createClient(url, chave, { auth: { persistSession: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: `${login}@${DOMINIO_LOGIN}`,
  password: senha,
  email_confirm: true,
  user_metadata: { nome },
});
if (error) {
  console.error("Erro ao criar usuário:", error.message);
  process.exit(1);
}
const { error: erroPerfil } = await admin
  .from("perfis")
  .insert({ id: data.user.id, login, nome, papel: "supervisor" });
if (erroPerfil) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error("Erro ao criar perfil:", erroPerfil.message);
  process.exit(1);
}
console.log(`Supervisor "${login}" criado. Entre no app com esse login e senha.`);
