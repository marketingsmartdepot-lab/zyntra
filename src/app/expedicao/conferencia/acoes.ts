"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";
import { pedirEtiqueta } from "../etiqueta";

/**
 * Abrir a conferência é MUTAÇÃO: cria a passagem pela bancada e congela o
 * esperado. Por isso é ação explícita e não acontece ao renderizar a página —
 * um GET não pode ter efeito colateral.
 */
export async function iniciarConferencia(pacoteId: string) {
  const supabase = await criarClienteServidor();

  // Guarda EM QUAL BANCADA a caixa foi conferida. Quem conferiu já fica em
  // concluida_por, pelo login — o turno de PIN deixou de existir.
  const estacao = await estacaoDaMaquina();

  const { error } = await supabase.rpc("abrir_conferencia", {
    p_pacote_id: pacoteId,
    p_estacao_id: estacao,
    p_sessao_id: null,
  });

  if (error) {
    return { ok: false, mensagem: traduzir(error.message) };
  }

  revalidatePath("/expedicao");
  return { ok: true, mensagem: null };
}

/**
 * Fecha a conferência e manda a etiqueta na mesma viagem.
 *
 * A etiqueta sai AQUI porque é aqui que a caixa fica pronta, e no galpão o
 * gesto é um só: o operador bipa o último produto e a etiqueta cai na
 * impressora. Era o contrário antes — fechava a conferência, e depois alguém
 * tinha que ir até a aba Pronto e clicar. Decisão da Daniele em 23/10, depois
 * de conferir uma caixa e nenhuma etiqueta sair.
 *
 * Os dois passos não são uma transação, e não podem ser: a etiqueta vem do
 * Mercado Livre por HTTP. Então a ordem importa — fecha primeiro, imprime
 * depois. Fechada sem etiqueta é recuperável (o botão da aba Pronto ainda
 * está lá); etiqueta impressa de caixa que não fechou seria papel colado em
 * caixa errada.
 */
export async function concluirConferencia(
  conferenciaId: string,
  pacoteId: string,
) {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc("concluir_conferencia", {
    p_conferencia_id: conferenciaId,
  });

  if (error) {
    return { ok: false, mensagem: traduzir(error.message), etiqueta: null };
  }

  const r = Array.isArray(data) ? data[0] : data;

  // Já estava fechada. Acontece de verdade: a leitura tem chave de
  // idempotência, então um bipe reenviado pela rede volta com o mesmo
  // `lidas`, a tela conclui que a caixa completou e tenta fechar de novo.
  // Isso não é erro — a caixa está fechada e a etiqueta já foi pedida na
  // primeira passagem. Pedir outra aqui só geraria "reimpressão sem motivo".
  if (!r?.ok && r?.motivo === "conferencia_nao_aberta") {
    return { ok: true, mensagem: null, etiqueta: null };
  }

  if (!r?.ok) {
    return {
      ok: false,
      etiqueta: null,
      mensagem:
        r?.motivo === "faltam_unidades"
          ? "Ainda faltam unidades na caixa."
          : r?.motivo === "divergencia_aberta"
            ? "Há divergência aberta. Só um líder pode liberar."
            : "Não foi possível concluir a conferência.",
    };
  }

  const etiqueta = pacoteId
    ? await pedirEtiqueta({ pacoteId })
    : { ok: false, motivo: "erro" };

  revalidatePath("/expedicao");
  return { ok: true, mensagem: null, etiqueta };
}

/**
 * Registrar divergência é o único jeito de sair de uma conferência que não
 * fecha. Sem isto o operador fica preso na bancada com a fila parada atrás —
 * e a saída que ele acha sozinho é pior: empurrar a caixa para o lado e
 * seguir, sem registro nenhum.
 */
export async function abrirDivergencia(formData: FormData) {
  const conferenciaId = String(formData.get("conferencia") ?? "");
  const tipo = String(formData.get("tipo") ?? "").trim();
  const detalhe = String(formData.get("detalhe") ?? "").trim();
  if (!conferenciaId || !tipo) return;

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("divergencias").insert({
    conferencia_id: conferenciaId,
    tipo,
    detalhe: detalhe || null,
    aberta_por: user?.id ?? null,
  });

  revalidatePath("/expedicao");
}

/**
 * Só um líder libera, e provando com o PIN dele aqui na bancada.
 *
 * O PIN nunca sobe pela URL: é POST de formulário, e o campo é do tipo senha
 * para não ficar na tela por cima do ombro de quem passa.
 */
export async function liberarDivergencia(formData: FormData) {
  const divergencia = String(formData.get("divergencia") ?? "");
  const pacote = String(formData.get("pacote") ?? "");
  const lider = String(formData.get("lider") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  const pin = String(formData.get("pin") ?? "");

  const voltar = (resultado: string) =>
    redirect(`/expedicao?etapa=conferir&pacote=${pacote}&liberacao=${resultado}`);

  if (!divergencia || !lider) return voltar("dados_incompletos");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("liberar_divergencia", {
    p_divergencia_id: divergencia,
    p_lider_id: lider,
    p_motivo: motivo,
    p_pin: pin,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath("/expedicao");
  voltar(r?.ok ? "ok" : (r?.motivo ?? "erro"));
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

/**
 * Zera uma conferência em andamento.
 *
 * Só quem tem a permissão liga isto — e o banco confere de novo, porque
 * esconder o botão não impede ninguém de chamar a função.
 *
 * O histórico do pacote guarda quem reiniciou. Uma caixa reiniciada três
 * vezes numa tarde é um sinal, e sinal apagado não avisa ninguém.
 */
export async function reiniciarConferencia(formData: FormData) {
  const conferencia = String(formData.get("conferencia") ?? "");
  const pacote = String(formData.get("pacote") ?? "");
  if (!conferencia) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("reiniciar_conferencia", {
    p_conferencia_id: conferencia,
  });

  revalidatePath("/expedicao");

  const r = Array.isArray(data) ? data[0] : data;
  const resultado = error ? "erro" : r?.ok ? "reiniciada" : (r?.motivo ?? "erro");

  redirect(`/expedicao?etapa=conferir&pacote=${pacote}&liberacao=${resultado}`);
}
