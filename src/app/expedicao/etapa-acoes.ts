"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Move à mão os pacotes marcados para outra etapa.
 *
 * Existe para destravar o caso que ninguém previu — e por isso aceita
 * QUALQUER destino, inclusive para trás. Quem limita é a permissão
 * `alterar_etapa`, não uma lista de destinos escolhida hoje: a emergência que
 * aparecer vai ser justamente a que eu tivesse bloqueado.
 *
 * O motivo é obrigatório e fica no histórico da caixa. Movimento manual é o
 * que alguém vai querer entender três semanas depois, e salto inexplicado no
 * histórico faz ninguém confiar no histórico inteiro.
 */
export async function alterarEtapaDosMarcados(formData: FormData) {
  const vista = String(formData.get("vista") ?? "aberto");
  const etapa = String(formData.get("etapa_destino") ?? "").trim();
  const motivo = String(formData.get("motivo_etapa") ?? "").trim();
  const marcados = formData.getAll("pacote").map(String).filter(Boolean);

  const voltar = (resultado: string, extra = "") =>
    redirect(`/expedicao?etapa=${vista}&etapa_alterada=${resultado}${extra}`);

  if (marcados.length === 0) return voltar("nada_selecionado");
  if (!etapa) return voltar("sem_destino");
  if (motivo.length < 5) return voltar("motivo_curto");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("alterar_etapa_de_varios", {
    p_pacote_ids: marcados,
    p_etapa: etapa,
    p_motivo: motivo,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.ok) return voltar(r?.motivo ?? "erro");

  revalidatePath("/expedicao");

  // Recusa não pode virar número solto: quem marcou vinte caixas precisa saber
  // QUAIS ficaram para trás, não quantas.
  const recusados = (r.recusados ?? []) as { codigo: string; motivo: string }[];
  const detalhe =
    recusados.length > 0
      ? `&etapa_recusados=${encodeURIComponent(
          recusados.map((x) => `${x.codigo}: ${x.motivo}`).join(" · "),
        )}`
      : "";

  voltar(`ok_${r.mudaram}`, detalhe);
}
