"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import { COOKIE_ESTACAO } from "@/lib/estacao";

export async function definirBancada(formData: FormData) {
  const id = String(formData.get("estacao") ?? "").trim();
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
