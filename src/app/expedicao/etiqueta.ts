"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina, turnoDaMaquina } from "@/lib/estacao";

/**
 * Manda a etiqueta do Mercado Livre para a impressora da bancada.
 *
 * Quem fala com o ML é a Edge Function `etiqueta`, não este servidor: o token
 * do ML fica confinado lá, com a chave de serviço, e nunca passa pelo app nem
 * pelo navegador. Daqui sai só o pedido e volta só "deu certo" ou o motivo.
 */
export async function imprimirEtiqueta(formData: FormData) {
  const pacoteId = String(formData.get("pacote") ?? "");
  if (!pacoteId) return;

  const motivoReimpressao = String(formData.get("motivo") ?? "").trim();

  const voltar = (resultado: string) =>
    redirect(`/expedicao?etapa=pronto&pacote=${pacoteId}&etiqueta=${resultado}`);

  const estacao = await estacaoDaMaquina();
  if (!estacao) {
    redirect(
      `/bancada?destino=${encodeURIComponent(`/expedicao?etapa=pronto&pacote=${pacoteId}`)}`,
    );
  }

  const supabase = await criarClienteServidor();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return voltar("sem_sessao");

  const turno = await turnoDaMaquina();

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
          operador_id: turno?.operadorId ?? null,
          motivo_reimpressao: motivoReimpressao || null,
        }),
      },
    );
  } catch {
    return voltar("servico_indisponivel");
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    ok?: boolean;
    motivo?: string;
  } | null;

  revalidatePath("/expedicao");
  voltar(corpo?.ok ? "ok" : (corpo?.motivo ?? "erro"));
}
