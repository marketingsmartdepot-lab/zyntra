"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function criarEstacao(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return;

  const supabase = await criarClienteServidor();
  await supabase.from("estacoes").insert({
    nome,
    local: String(formData.get("local") ?? "").trim() || null,
  });

  revalidatePath("/integracao");
}

export async function criarImpressora(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return;

  const supabase = await criarClienteServidor();
  await supabase.from("impressoras").insert({
    nome,
    estacao_id: String(formData.get("estacao") ?? "") || null,
    modelo: String(formData.get("modelo") ?? "").trim() || null,
    linguagem: String(formData.get("linguagem") ?? "zpl"),
    conexao: String(formData.get("conexao") ?? "usb"),
    dpi: Number(formData.get("dpi")) || null,
    largura_mm: Number(formData.get("largura")) || null,
  });

  revalidatePath("/integracao");
}

export type ResultadoToken = {
  token: string | null;
  erro: string | null;
};

export async function gerarToken(
  _anterior: ResultadoToken,
  formData: FormData,
): Promise<ResultadoToken> {
  const id = String(formData.get("impressora") ?? "");
  if (!id) return { token: null, erro: "Impressora não informada." };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("gerar_token_agente", {
    p_impressora_id: id,
  });

  if (error) {
    return {
      token: null,
      erro: error.message.includes("administrador")
        ? "Só administrador gera token de agente."
        : error.message,
    };
  }

  revalidatePath("/integracao");
  return { token: String(data), erro: null };
}
