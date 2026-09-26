"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const VOLTAR = "/integracao?aba=contas";

/**
 * Guarda as credenciais do aplicativo do Mercado Livre.
 *
 * A secret vem daqui, da tela dela, e nunca de conversa nem de arquivo no
 * repositório. Ela entra, é gravada no schema privado e não volta em leitura
 * nenhuma — a tela mostra só o client_id.
 */
export async function salvarAplicacaoMl(formData: FormData) {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc("salvar_aplicacao_ml", {
    p_client_id: String(formData.get("client_id") ?? "").trim(),
    p_client_secret: String(formData.get("client_secret") ?? "").trim(),
    p_redirect_uri: String(formData.get("redirect_uri") ?? "").trim(),
    p_usa_pkce: String(formData.get("usa_pkce") ?? "") === "on",
  });

  revalidatePath("/integracao");

  const r = Array.isArray(data) ? data[0] : data;
  redirect(`${VOLTAR}&ml=${error ? "erro" : r?.ok ? "app_salvo" : (r?.motivo ?? "erro")}`);
}

/**
 * Manda a pessoa ao Mercado Livre para autorizar.
 *
 * Sem `conta` é conta nova — qual é só se sabe quando o ML responde. Com
 * `conta` é reconexão daquela conta, e o ML tem de devolver o mesmo usuário.
 */
export async function conectarConta(formData: FormData) {
  const conta = String(formData.get("conta") ?? "").trim();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("iniciar_oauth_conta", {
    p_conta_id: conta || null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok || !r?.url) {
    redirect(`${VOLTAR}&ml=${error ? "erro" : (r?.motivo ?? "erro")}`);
  }

  // Sai do ZYNTRA e vai para o Mercado Livre. A volta é pela rota de retorno.
  redirect(r.url as string);
}
