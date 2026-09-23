"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";

/**
 * Abrir turno é dizer QUEM está nesta bancada agora.
 *
 * A máquina fica logada o dia inteiro com a conta da equipe — isso identifica
 * o computador, não a pessoa. O PIN identifica a pessoa, e é o que faz cada
 * bipe, cada conferência e cada liberação ter dono.
 *
 * Abrir um turno encerra o anterior daquela bancada: só existe uma pessoa na
 * bancada por vez, e deixar dois turnos abertos faria o trabalho de um ser
 * creditado ao outro.
 */
export async function abrirTurno(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const destino = String(formData.get("destino") ?? "/expedicao");

  const estacao = await estacaoDaMaquina();
  if (!estacao) redirect("/bancada?destino=/turno");
  if (!operador) return redirect("/turno?falha=sem_operador");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("abrir_sessao_estacao", {
    p_estacao_id: estacao,
    p_operador_id: operador,
    p_pin: pin,
  });

  if (error) return redirect("/turno?falha=erro");

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath("/", "layout");

  if (!r?.ok) return redirect(`/turno?falha=${r?.motivo ?? "erro"}`);

  redirect(destino.startsWith("/") && !destino.startsWith("//") ? destino : "/expedicao");
}

export async function encerrarTurno() {
  const estacao = await estacaoDaMaquina();
  if (!estacao) redirect("/bancada");

  const supabase = await criarClienteServidor();
  await supabase.rpc("encerrar_sessao_estacao", { p_estacao_id: estacao });

  revalidatePath("/", "layout");
  redirect("/turno?falha=encerrado");
}
