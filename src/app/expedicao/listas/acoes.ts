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
export async function gerarLista(destino: string, formData: FormData) {
  const vista = String(formData.get("vista") ?? "separar");
  const ids = formData.getAll("pacote").map(String).filter(Boolean);

  // Sair calada aqui era indistinguivel de estar quebrado: a tela JA tem a
  // frase ("Marque pelo menos uma caixa antes.") e nunca a recebia. As outras
  // tres acoes da Expedicao mandam `nada_selecionado`; so esta nao mandava.
  if (ids.length === 0) {
    redirect(`/expedicao?etapa=${vista}&falha=nada_selecionado`);
  }

  // O modo vem AMARRADO na ação, não num `name` do botão: o name/value do
  // botão que submete não chega de forma confiável até uma Server Action, e
  // o resultado disso foi uma lista de coletor nascendo como papel — com os
  // pedidos indo para Conferir sem ninguém separar.
  const modo = destino === "coletor" ? "coletor" : "papel";

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
    p_modo: modo,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    // A mensagem do erro ia para o lixo, trocada por "erro" -- e "erro" nao
    // diz a ninguem o que fazer. Vai o motivo que o banco devolveu; quando o
    // erro e do transporte, vai o texto dele, que e o que falta para
    // diagnosticar sem adivinhar.
    const motivo = error ? `erro:${error.message}` : (r?.motivo ?? "erro");
    revalidatePath("/expedicao");
    redirect(
      `/expedicao?etapa=${vista}&falha=${encodeURIComponent(motivo)}`,
    );
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
