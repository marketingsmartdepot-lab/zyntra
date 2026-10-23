"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import { COOKIE_ESTACAO } from "@/lib/estacao";

/**
 * Grava qual bancada é esta máquina.
 *
 * A bancada vem AMARRADA na ação, não num `name` do botão: o name/value de um
 * botão de envio não chega de forma confiável numa Server Action, e o sintoma
 * é o pior possível — a ação roda, não recebe nada, e volta calada. Quem
 * clicou jura que escolheu, e a lateral segue dizendo "não escolhida".
 *
 * Mesmo erro que fazia "mandar pro coletor" gerar lista de papel.
 */
export async function definirBancada(estacaoId: string, formData: FormData) {
  const id = String(estacaoId ?? "").trim();
  const destino = String(formData.get("destino") ?? "/expedicao");
  if (!id) return;

  // Confere que a bancada existe antes de gravar. Cookie com id inventado
  // faria toda impressão falhar com 'estacao_sem_impressora', que é um erro
  // que aponta para o lugar errado.
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("estacoes")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!data) return;

  const jar = await cookies();
  jar.set(COOKIE_ESTACAO, id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });

  revalidatePath("/", "layout");
  redirect(destino);
}

export async function esquecerBancada() {
  const jar = await cookies();
  jar.delete(COOKIE_ESTACAO);
  revalidatePath("/", "layout");
  redirect("/bancada");
}
