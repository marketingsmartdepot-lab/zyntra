"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { COOKIE_OPERADOR } from "@/lib/operador";

/**
 * "Quem é você?" no aparelho, por PIN.
 *
 * Nome + PIN, e não PIN sozinho: com PIN sozinho eu teria de garantir que duas
 * pessoas nunca escolhessem o mesmo número, e a trava de cinco erros deixaria
 * de proteger alguém específico. Um toque no nome resolve os dois.
 */
export async function identificarNoAparelho(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const voltar = String(formData.get("voltar") ?? "/");

  if (!operador || !pin) redirect(`${voltar}?quem=faltou`);

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("identificar_operador", {
    p_operador_id: operador,
    p_pin: pin,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    redirect(`${voltar}?quem=${r?.motivo ?? "erro"}`);
  }

  (await cookies()).set(COOKIE_OPERADOR, operador, {
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
  });

  revalidatePath(voltar);
  // O cookie recém-gravado não é visível no desenho desta mesma resposta, por
  // isso o parâmetro: sem ele a tela voltaria perguntando de novo.
  redirect(`${voltar}?quem=ok&eu=${operador}`);
}

/** Sair do aparelho — fim de turno, ou a pessoa errada assumiu. */
export async function sairDoAparelho(formData: FormData) {
  const voltar = String(formData.get("voltar") ?? "/");
  (await cookies()).delete(COOKIE_OPERADOR);
  revalidatePath(voltar);
  redirect(`${voltar}?quem=saiu`);
}
