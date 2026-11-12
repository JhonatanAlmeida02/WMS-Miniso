import { toast } from "sonner";
import { mensagemErro, supabase } from "./supabase";
import type { StatusRemessa } from "./tipos";

export async function alterarStatus(id: number, status: StatusRemessa) {
  const { error } = await supabase.rpc("alterar_status_remessa", { p_remessa: id, p_status: status });
  if (error) {
    toast.error(mensagemErro(error));
    return false;
  }
  toast.success(
    status === "ativa" ? "Remessa ativada: já aparece para os operadores" : status === "concluida" ? "Remessa concluída" : "Remessa voltou para pendente",
  );
  return true;
}

export async function excluirRemessa(id: number) {
  const { error } = await supabase.rpc("excluir_remessa", { p_remessa: id });
  if (error) {
    toast.error(mensagemErro(error));
    return false;
  }
  toast.success("Remessa excluída");
  return true;
}
