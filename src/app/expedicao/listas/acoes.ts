"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { turnoDaMaquina } from "@/lib/estacao";

/**
 * Gera a lista de separação a partir dos pacotes marcados em Separar.
 *
 * Gerar a lista e mandar os pedidos para Conferir é um ato só: no corredor
 * ninguém volta num computador para anunciar que terminou.
 *
 * O papel NÃO sai sozinho. A folha é A4 comum, e qual impressora do corredor
 * está livre muda ao longo do dia — quem escolhe é quem está lá, pela caixa
 * de impressão do navegador. A bancada configurada serve para a etiqueta
 * térmica, que é sempre a mesma.
 *
 * Quem está no turno desta bancada fica gravado como separador. É o registro
 * que se consulta quando uma caixa some ou vem trocada.
 */
export async function gerarLista(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const turno = await turnoDaMaquina();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
    p_separador_id: turno?.operadorId ?? null,
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
