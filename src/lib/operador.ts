import { cookies } from "next/headers";
import { criarClienteServidor } from "@/lib/supabase/server";

const COOKIE = "zyntra_operador";

export type NoAparelho = { id: string; nome: string } | null;

/**
 * Quem está no aparelho agora, identificado por PIN.
 *
 * Fica num cookie do APARELHO, não da pessoa: o coletor e o computador da
 * porta ficam logados com uma conta da equipe, e o PIN diz quem está com ele
 * na mão. É a mesma ideia do turno da bancada, sem exigir estação cadastrada.
 *
 * Doze horas de validade — um turno. Mais que isso e o aparelho amanheceria
 * no nome de quem foi embora ontem.
 */
export async function noAparelho(): Promise<NoAparelho> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;

  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("operadores_para_identificar")
    .select("id, nome")
    .eq("id", id)
    .maybeSingle();

  // Sumiu da lista (desativado, PIN removido): o cookie deixa de valer.
  return (data as { id: string; nome: string } | null) ?? null;
}

export const COOKIE_OPERADOR = COOKIE;
