"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const VOLTAR = "/integracao?aba=estoque";

function encerrar(falha?: string) {
  revalidatePath("/integracao");
  redirect(falha ? `${VOLTAR}&falha=${falha}` : VOLTAR);
}

/**
 * Guarda o aplicativo criado no painel de desenvolvedor do Bling.
 *
 * O segredo vai daqui direto para o banco, dentro do schema privado, e nunca
 * volta para tela nenhuma — o que a interface mostra depois são os seis
 * últimos caracteres do client_id, só para conferência de que é o app certo.
 */
export async function salvarAplicacaoBling(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "");
  const clientSecret = String(formData.get("client_secret") ?? "");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("definir_aplicacao_erp", {
    p_client_id: clientId,
    p_client_secret: clientSecret,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/**
 * Manda a pessoa para a tela de consentimento do Bling.
 *
 * O `state` nasce no banco e é de uso único. Quem volta do Bling sem ele, ou
 * com um que já foi usado, é recusado antes de qualquer conversa — reusar o
 * código de autorização faz o Bling revogar o acesso inteiro.
 */
export async function conectarBling() {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("iniciar_oauth_erp");

  const r = Array.isArray(data) ? data[0] : data;
  if (error || !r?.ok || !r?.url) {
    return encerrar(error ? "erro" : (r?.motivo ?? "erro"));
  }

  // Sai do ZYNTRA: daqui quem manda é a tela do Bling.
  redirect(r.url as string);
}

export async function desconectarBling() {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("desconectar_erp");

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}
