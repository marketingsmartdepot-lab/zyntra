"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const VOLTAR = "/integracao?aba=equipe";

function encerrar(falha?: string) {
  revalidatePath("/integracao");
  redirect(falha ? `${VOLTAR}&falha=${falha}` : VOLTAR);
}

/**
 * Libera um e-mail a usar o ZYNTRA.
 *
 * A autorização é por e-mail, não por convite enviado: quem cria a senha é a
 * própria pessoa, e o sistema só reconhece quem já estava nesta lista. Quem
 * não está pode até criar um login — nasce inativo e não enxerga nada.
 */
export async function autorizarPessoa(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const papel = String(formData.get("papel") ?? "operador");
  const nome = String(formData.get("nome") ?? "").trim();
  if (!email) return encerrar("email_invalido");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("autorizar_pessoa", {
    p_email: email,
    p_papel: papel,
    p_nome: nome || null,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/** Corta o acesso agora e apaga a autorização. */
export async function revogarPessoa(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  if (!email) return encerrar("email_invalido");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("revogar_pessoa", {
    p_email: email,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

export async function definirPapel(formData: FormData) {
  const perfil = String(formData.get("perfil") ?? "");
  const papel = String(formData.get("papel") ?? "");
  if (!perfil || !papel) return encerrar("erro");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("definir_papel_perfil", {
    p_perfil_id: perfil,
    p_papel: papel,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}
