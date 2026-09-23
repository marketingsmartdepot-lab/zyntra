"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Abre a relação de saída de um destino.
 *
 * O nome de quem leva é digitado aqui, na abertura, e não a cada pacote: é uma
 * pessoa por carga. Se a relação já estiver aberta, o banco devolve a mesma —
 * o operador voltou para ela, não pediu outra.
 */
export async function abrirSaida(formData: FormData) {
  const modalidade = String(formData.get("modalidade") ?? "").trim();
  if (!modalidade) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("abrir_saida", {
    p_modalidade_id: modalidade,
    p_motorista: String(formData.get("motorista") ?? "").trim() || null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    revalidatePath("/logistica");
    redirect(`/logistica?aba=doca&falha=${r?.motivo ?? "erro"}`);
  }

  revalidatePath("/logistica");
  redirect(`/logistica?aba=saida&saida=${r.saida_id}&bipar=1`);
}

export async function fecharSaida(formData: FormData) {
  const saida = String(formData.get("saida") ?? "");
  if (!saida) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("fechar_saida", {
    p_saida_id: saida,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    revalidatePath("/logistica");
    redirect(`/logistica?aba=saida&saida=${saida}&bipar=1&falha=${r?.motivo ?? "erro"}`);
  }

  revalidatePath("/logistica");
  redirect(`/logistica?aba=saida&fechada=${saida}`);
}
