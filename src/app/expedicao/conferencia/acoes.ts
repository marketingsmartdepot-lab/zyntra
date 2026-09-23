"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Abrir a conferência é MUTAÇÃO: cria a passagem pela bancada e congela o
 * esperado. Por isso é ação explícita e não acontece ao renderizar a página —
 * um GET não pode ter efeito colateral.
 */
export async function iniciarConferencia(pacoteId: string) {
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("abrir_conferencia", {
    p_pacote_id: pacoteId,
  });

  if (error) {
    return { ok: false, mensagem: traduzir(error.message) };
  }

  revalidatePath("/expedicao");
  return { ok: true, mensagem: null };
}

export async function concluirConferencia(conferenciaId: string) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("concluir_conferencia", {
    p_conferencia_id: conferenciaId,
  });

  if (error) return { ok: false, mensagem: traduzir(error.message) };

  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.ok) {
    return {
      ok: false,
      mensagem:
        r?.motivo === "faltam_unidades"
          ? "Ainda faltam unidades na caixa."
          : r?.motivo === "divergencia_aberta"
            ? "Há divergência aberta. Só um líder pode liberar."
            : "Não foi possível concluir a conferência.",
    };
  }

  revalidatePath("/expedicao");
  return { ok: true, mensagem: null };
}

export async function abrirDivergencia(
  conferenciaId: string,
  tipo: string,
  detalhe: string,
) {
  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("divergencias").insert({
    conferencia_id: conferenciaId,
    tipo,
    detalhe: detalhe.trim() || null,
  });

  if (error) return { ok: false, mensagem: traduzir(error.message) };

  revalidatePath("/expedicao");
  return { ok: true, mensagem: null };
}

function traduzir(mensagem: string) {
  if (mensagem.includes("nao esta na etapa de conferencia")) {
    return "Este pacote não está na etapa de conferência.";
  }
  if (mensagem.includes("Nenhum item com SKU mapeado")) {
    return "Nenhum item deste pacote tem SKU mapeado. Sem saber o que esperar, a conferência não valida nada — mapeie o anúncio primeiro.";
  }
  return mensagem;
}
