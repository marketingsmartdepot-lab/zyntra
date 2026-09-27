"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { turnoDaMaquina } from "@/lib/estacao";

/**
 * Abre a relação de saída de um destino.
 *
 * O nome de quem leva é digitado aqui, na abertura, e não a cada pacote: é uma
 * pessoa por carga. Se a relação já estiver aberta, o banco devolve a mesma —
 * o operador voltou para ela, não pediu outra.
 */
export async function abrirSaida(formData: FormData) {
  const modalidade = String(formData.get("modalidade") ?? "").trim();
  if (!modalidade) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("abrir_saida", {
    p_modalidade_id: modalidade,
    p_motorista: String(formData.get("motorista") ?? "").trim() || null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    revalidatePath("/logistica");
    redirect(`/logistica?aba=doca&falha=${r?.motivo ?? "erro"}`);
  }

  revalidatePath("/logistica");
  redirect(`/logistica?aba=saida&saida=${r.saida_id}&bipar=1`);
}

export async function fecharSaida(formData: FormData) {
  const saida = String(formData.get("saida") ?? "");
  if (!saida) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("fechar_saida", {
    p_saida_id: saida,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    revalidatePath("/logistica");
    redirect(`/logistica?aba=saida&saida=${saida}&bipar=1&falha=${r?.motivo ?? "erro"}`);
  }

  revalidatePath("/logistica");
  redirect(`/logistica?aba=saida&fechada=${saida}`);
}

/**
 * Abre a relação de entrega para a doca.
 *
 * O nome de quem leva é pedido aqui, uma vez por carrinho. É por ele que se
 * descobre quem estava com a caixa quando ela some — e some, num galpão.
 */
export async function abrirEntregaDoca(formData: FormData) {
  const nome = String(formData.get("entregue_por") ?? "").trim();
  const selecionados = formData.getAll("pacote").map(String).filter(Boolean);

  if (!nome) {
    // Veio da aba Pronto pra envio, onde a falha tem de voltar para lá.
    if (selecionados.length > 0) {
      redirect("/expedicao?etapa=pronto&falha=sem_nome");
    }
    return;
  }

  const supabase = await criarClienteServidor();
  const turno = await turnoDaMaquina();

  const { data, error } = await supabase.rpc("abrir_entrega_doca", {
    p_entregue_por: nome,
    p_operador_id: turno?.operadorId ?? null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    revalidatePath("/logistica");
    redirect(`/logistica?aba=doca&falha=${r?.motivo ?? "erro"}`);
  }

  // Marcou caixas na esteira? Elas vão junto, sem bipar. As regras são as
  // mesmas do bipe — o que muda é só por onde a caixa foi apontada.
  if (selecionados.length > 0) {
    const { data: posto } = await supabase.rpc("entregar_selecionados_na_doca", {
      p_entrega_id: r.entrega_id,
      p_pacote_ids: selecionados,
    });

    const p = Array.isArray(posto) ? posto[0] : posto;
    const recusados = (p?.recusados ?? []) as { codigo: string; motivo: string }[];

    revalidatePath("/expedicao");
    revalidatePath("/logistica");

    // Recusa não pode virar número solto: quem empurra o carrinho precisa
    // saber QUAL caixa ficou para trás, com a pilha ainda na frente.
    redirect(
      `/logistica?aba=doca&entrega=${r.entrega_id}&bipar=1&levados=${p?.entraram ?? 0}` +
        (recusados.length > 0
          ? `&recusados=${encodeURIComponent(JSON.stringify(recusados))}`
          : ""),
    );
  }

  revalidatePath("/logistica");
  redirect(`/logistica?aba=doca&entrega=${r.entrega_id}&bipar=1`);
}
