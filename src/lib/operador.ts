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

  // Por função, e não pela view: a view lê `operadores` com os direitos de
  // quem pergunta, e a conta do aparelho não tem — nem pode ter. Aquela
  // tabela guarda `pin_hash`, e política de RLS é por LINHA, não por coluna:
  // liberar a leitura entregaria os hashes de todos os PINs à sessão de um
  // celular. A função devolve só id e nome.
  const { data } = await supabase.rpc("operador_da_porta", { p_id: id });
  const achado = (Array.isArray(data) ? data[0] : data) as
    | { id: string; nome: string }
    | null
    | undefined;

  // Sumiu da lista (desativado, PIN removido): o cookie deixa de valer.
  return achado ?? null;
}

export const COOKIE_OPERADOR = COOKIE;
