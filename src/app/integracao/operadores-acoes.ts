"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * O operador do galpão não é usuário do sistema.
 *
 * Quem entra no ZYNTRA tem e-mail e senha; quem trabalha na bancada tem nome e
 * PIN. São coisas diferentes de propósito: a máquina da bancada fica logada o
 * dia inteiro com a conta da equipe, e o PIN é o que diz QUEM está ali agora.
 */
export async function criarOperador(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const papel = String(formData.get("papel") ?? "operador");
  if (!nome) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("operadores")
    .insert({ nome, papel, ativo: true });

  revalidatePath("/integracao");
  if (error) {
    redirect(
      `/integracao?aba=operadores&falha=${
        error.message.includes("row-level security") ? "sem_permissao" : "erro"
      }`,
    );
  }
}

/**
 * O PIN vai por POST e nunca pela URL, e o campo é do tipo senha: quem cadastra
 * está com outra pessoa do lado, que não precisa ver o PIN dela na tela.
 */
export async function definirPin(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const pin = String(formData.get("pin") ?? "");
  if (!operador) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("definir_pin_operador", {
    p_operador_id: operador,
    p_pin: pin,
  });

  revalidatePath("/integracao");

  const resultado = !error
    ? "pin_ok"
    : error.message.includes("4 a 8")
      ? "pin_formato"
      : error.message.includes("So lider ou administrador")
        ? "sem_permissao"
        : "erro";

  redirect(`/integracao?aba=operadores&falha=${resultado}`);
}

export async function alternarOperador(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const ativo = String(formData.get("ativo") ?? "") === "1";
  if (!operador) return;

  const supabase = await criarClienteServidor();
  await supabase.from("operadores").update({ ativo }).eq("id", operador);

  revalidatePath("/integracao");
}

/**
 * Destravar quem errou o PIN cinco vezes. Sem isto a única saída seria esperar
 * dez minutos parado — e num galpão dez minutos de bancada parada é fila.
 */
export async function destravarOperador(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  if (!operador) return;

  const supabase = await criarClienteServidor();
  await supabase
    .from("operadores")
    .update({ tentativas_falhas: 0, bloqueado_ate: null })
    .eq("id", operador);

  revalidatePath("/integracao");
}
