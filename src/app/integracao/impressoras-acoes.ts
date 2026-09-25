"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const VOLTAR = "/integracao?aba=impressoras";

function encerrar(falha?: string) {
  revalidatePath("/integracao");
  redirect(falha ? `${VOLTAR}&falha=${falha}` : VOLTAR);
}

/**
 * Define o que uma impressora descoberta é.
 *
 * Nome e máquina vêm do agente e não se editam aqui — é justamente por não
 * serem digitados que eles nunca erram. O que se escolhe é o papel dela: se
 * imprime etiqueta, de qual bancada, e quantas cópias.
 */
export async function ajustarImpressora(formData: FormData) {
  const id = String(formData.get("impressora") ?? "");
  const linguagem = String(formData.get("linguagem") ?? "zpl");
  const ativa = String(formData.get("ativa") ?? "sim") === "sim";
  const estacao = String(formData.get("estacao") ?? "");
  const copias = Number(formData.get("copias") ?? 1);

  if (!id) return encerrar("erro");
  // Valor fora da lista não chega ao banco: lá existe uma restrição, mas
  // recusar aqui dá uma mensagem em vez de um erro de banco.
  if (!["zpl", "pdf"].includes(linguagem)) return encerrar("linguagem_invalida");

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("impressoras")
    .update({
      linguagem,
      ativa,
      estacao_id: estacao || null,
      copias: Number.isFinite(copias) ? Math.min(Math.max(copias, 1), 10) : 1,
    })
    .eq("id", id);

  encerrar(
    error
      ? error.message.includes("row-level security")
        ? "sem_permissao"
        : "erro"
      : undefined,
  );
}

/** Cria uma bancada, para haver a quem atribuir a impressora. */
export async function criarBancada(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return encerrar("sem_nome");

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("estacoes").insert({ nome });

  encerrar(
    error
      ? error.message.includes("row-level security")
        ? "sem_permissao"
        : "erro"
      : undefined,
  );
}

/**
 * Tira uma máquina do sistema.
 *
 * A credencial dela morre junto — é assim que se resolve um computador
 * roubado, trocado ou aposentado, sem ninguém precisar mudar de senha.
 */
export async function revogarMaquina(formData: FormData) {
  const id = String(formData.get("maquina") ?? "");
  if (!id) return encerrar("erro");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("revogar_maquina", { p_id: id });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}
