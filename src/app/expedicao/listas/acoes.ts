"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

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
 * Quem gerou a lista fica gravado como separador — pelo LOGIN, não por PIN.
 * Quem separa usa o sistema; o PIN identifica só quem bipa os carros na porta.
 */
export async function gerarLista(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  if (ids.length === 0) return;

  // Papel ou coletor. No papel os pedidos já saem para Conferir neste clique,
  // como sempre foi; no coletor eles ficam em Separar até alguém fechar a
  // separação no aparelho.
  const modo = String(formData.get("modo") ?? "papel") === "coletor"
    ? "coletor"
    : "papel";

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
    p_modo: modo,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    const motivo = error ? "erro" : r?.motivo;
    revalidatePath("/expedicao");
    redirect(`/expedicao?etapa=separar&falha=${motivo}`);
  }

  revalidatePath("/expedicao");

  // O coletor abre já na tela de separação: quem apertou está indo para o
  // corredor, não para o registro da lista.
  redirect(
    modo === "coletor"
      ? `/separacao/${r.lista}`
      : `/expedicao?etapa=listas&lista=${r.lista}`,
  );
}
