"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";

/**
 * Pede a etiqueta do Mercado Livre e manda para a impressora da bancada.
 *
 * Quem fala com o ML é a Edge Function `etiqueta`, não este servidor: o token
 * do ML fica confinado lá, com a chave de serviço, e nunca passa pelo app nem
 * pelo navegador. Daqui sai só o pedido e volta só "deu certo" ou o motivo.
 *
 * Esta função NÃO redireciona e NÃO decide tela: ela só devolve o resultado.
 * É chamada de dois lugares com necessidades opostas — do botão da aba Pronto,
 * que navega, e do bipe que completa a caixa, que não pode navegar no meio da
 * leitura.
 */
export async function pedirEtiqueta({
  pacoteId,
  motivoReimpressao,
}: {
  pacoteId: string;
  motivoReimpressao?: string | null;
}): Promise<{ ok: boolean; motivo: string }> {
  const estacao = await estacaoDaMaquina();

  // Sem bancada não há impressora. Quem chama de um formulário manda a pessoa
  // escolher a bancada; o bipe só mostra a frase, porque interromper a leitura
  // com uma navegação seria pior.
  if (!estacao) return { ok: false, motivo: "estacao_nao_informada" };

  const supabase = await criarClienteServidor();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return { ok: false, motivo: "sem_sessao" };

  // ---------------------------------------- o caminho curto, que é o normal
  //
  // A etiqueta já está guardada aqui quando a caixa chega na bancada: dois
  // cron de cinco em cinco minutos baixam o ZPL do ML logo que o envio fica
  // pronto para despacho. Então o caminho comum não precisa da Edge Function
  // — ela existe para falar com o ML, e aqui não há ML para falar.
  //
  // São ~2 dos 4 segundos entre o bipe e a etiqueta: a Edge Function custa
  // quatro idas e voltas (validar o JWT, ler o perfil, ler o pacote,
  // enfileirar) e todas já estão feitas ou são desnecessárias daqui.
  //
  // As guardas não ficaram para trás: conferência fechada, modalidade que
  // gera etiqueta, bancada com impressora e agente online estão todas dentro
  // de `privado.enfileirar_impressao`, por onde os dois caminhos passam.
  const { data: guardado } = await supabase
    .from("pacotes")
    .select("envios ( etiqueta_conteudo )")
    .eq("id", pacoteId)
    .maybeSingle();

  // `envios` é um-para-um aqui, mas os tipos gerados do PostgREST o declaram
  // como lista. Aceitar as duas formas é mais barato que brigar com o tipo.
  const relacao: unknown = guardado?.envios;
  const envio = (Array.isArray(relacao) ? relacao[0] : relacao) as
    | { etiqueta_conteudo: string | null }
    | null
    | undefined;

  const zplGuardado = (envio?.etiqueta_conteudo ?? "").trim();

  if (zplGuardado.includes("^XA")) {
    const { data, error } = await supabase.rpc("solicitar_impressao", {
      p_tipo: "etiqueta",
      p_conteudo: zplGuardado,
      p_pacote_id: pacoteId,
      p_estacao_id: estacao,
      p_operador_id: session.user.id,
      p_motivo_reimpressao: motivoReimpressao || null,
    });

    // Só uma falha de CHAMADA cai para a Edge Function. Recusa com motivo
    // ("agente_offline", "reimpressão sem motivo") é resposta, não falha:
    // tentar de novo pelo caminho longo daria a mesma recusa dois segundos
    // mais tarde.
    if (!error) {
      const r = Array.isArray(data) ? data[0] : data;
      return r?.ok
        ? { ok: true, motivo: "ok" }
        : { ok: false, motivo: r?.motivo ?? "erro" };
    }
  }

  // --------------------- o caminho longo: a etiqueta ainda não desceu do ML
  let resposta: Response;
  try {
    resposta = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/etiqueta`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pacote_id: pacoteId,
          estacao_id: estacao,
          // Quem mandou imprimir é o login. O PIN identifica só a doca e a
          // porta, onde ninguém está com o navegador logado.
          operador_id: session.user.id,
          motivo_reimpressao: motivoReimpressao || null,
        }),
      },
    );
  } catch {
    return { ok: false, motivo: "servico_indisponivel" };
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    ok?: boolean;
    motivo?: string;
  } | null;

  return corpo?.ok
    ? { ok: true, motivo: "ok" }
    : { ok: false, motivo: corpo?.motivo ?? "erro" };
}

/** O botão da aba Pronto: imprime e volta para a tela com o resultado. */
export async function imprimirEtiqueta(formData: FormData) {
  const pacoteId = String(formData.get("pacote") ?? "");
  if (!pacoteId) return;

  const motivoReimpressao = String(formData.get("motivo") ?? "").trim();

  const estacao = await estacaoDaMaquina();
  if (!estacao) {
    redirect(
      `/bancada?destino=${encodeURIComponent(`/expedicao?etapa=pronto&pacote=${pacoteId}`)}`,
    );
  }

  const r = await pedirEtiqueta({ pacoteId, motivoReimpressao });

  revalidatePath("/expedicao");
  redirect(
    `/expedicao?etapa=pronto&pacote=${pacoteId}&impressao_etiqueta=${r.motivo}`,
  );
}
