"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

function voltar(vista: string, params: Record<string, string>) {
  revalidatePath("/expedicao");
  const p = new URLSearchParams({ etapa: vista, ...params });
  redirect(`/expedicao?${p.toString()}`);
}

/**
 * Tira pacotes da esteira por problema externo.
 *
 * O motivo é obrigatório e vai para o histórico do pacote. Retenção sem motivo
 * vira mistério uma semana depois, quando alguém tentar entender por que a
 * caixa parou — e aí não há a quem perguntar.
 */
export async function reterPacotes(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  const vista = String(formData.get("vista") ?? "separar");
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (ids.length === 0) return voltar(vista, { falha: "nada_selecionado" });
  if (!motivo) return voltar(vista, { falha: "sem_motivo" });

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("reter_pacotes", {
    p_ids: ids,
    p_motivo: motivo,
  });

  if (error) return voltar(vista, { falha: "erro" });

  const r = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean;
    motivo: string;
    retidos: number;
    recusados: { codigo: string; motivo: string }[] | null;
  } | null;

  if (!r?.ok) return voltar(vista, { falha: r?.motivo ?? "erro" });

  const p: Record<string, string> = {
    feito: "retidos",
    quantos: String(r.retidos),
  };
  if (r.recusados && r.recusados.length > 0) {
    p.recusados = JSON.stringify(r.recusados).slice(0, 1200);
  }
  return voltar(vista, p);
}

/**
 * Devolve pacotes retidos para onde eles estavam.
 *
 * Não para o começo: o trabalho já feito — nota, etiqueta, separação —
 * continua valendo. Quem lembra a etapa de origem é o gatilho de transição.
 */
export async function tirarDoRetido(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);

  if (ids.length === 0) return voltar("retido", { falha: "nada_selecionado" });

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("tirar_do_retido", { p_ids: ids });

  if (error) return voltar("retido", { falha: "erro" });

  const r = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean;
    motivo: string;
    devolvidos: number;
    recusados: { codigo: string; motivo: string }[] | null;
  } | null;

  if (!r?.ok) return voltar("retido", { falha: r?.motivo ?? "erro" });

  const p: Record<string, string> = {
    feito: "devolvidos",
    quantos: String(r.devolvidos),
  };
  if (r.recusados && r.recusados.length > 0) {
    p.recusados = JSON.stringify(r.recusados).slice(0, 1200);
  }
  return voltar("retido", p);
}
