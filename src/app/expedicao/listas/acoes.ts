"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function gerarLista(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    const motivo = error ? "erro" : r?.motivo;
    revalidatePath("/expedicao");
    redirect(`/expedicao?etapa=separar&falha=${motivo}`);
  }

  revalidatePath("/expedicao");
  redirect(`/expedicao?etapa=listas&lista=${r.lista}`);
}

export async function concluirLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const supabase = await criarClienteServidor();
  await supabase.rpc("concluir_lista", { p_lista_id: listaId });

  revalidatePath("/expedicao");
  redirect("/expedicao?etapa=conferir");
}

export async function iniciarLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const supabase = await criarClienteServidor();
  await supabase
    .from("listas_separacao")
    .update({ situacao: "em_execucao", iniciada_em: new Date().toISOString() })
    .eq("id", listaId)
    .eq("situacao", "aguardando");

  revalidatePath("/expedicao");
}
