"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

/** Quantos pedidos por clique. Ver explicação em `reprocessarCausa`. */
const POR_VEZ = 20;

type Pedido = { pedido_id: string; ref_externa: string };

/**
 * Pede a nota de novo para todos os pedidos parados por uma causa.
 *
 * O trabalho é por pedido porque a nota é por pedido — um NCM consertado
 * destrava trinta vendas, mas são trinta emissões.
 *
 * Em blocos de vinte, e sequencial: cada emissão é irreversível, e disparar
 * trinta chamadas em paralelo contra o Mercado Livre é o jeito mais rápido de
 * tomar bloqueio por excesso de requisição no meio do lote, sem saber quais
 * passaram. Se sobrar, o botão continua lá com o número novo.
 */
export async function reprocessarCausa(formData: FormData) {
  const tipo = String(formData.get("tipo") ?? "");
  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!tipo) return;

  const supabase = await criarClienteServidor();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const voltar = (r: string) => redirect(`/expedicao?etapa=aberto&reprocesso=${r}`);

  if (!session) return voltar("sem_sessao");

  const { data, error } = await supabase.rpc("pedidos_da_causa", {
    p_tipo: tipo,
    p_codigo: codigo || null,
  });

  if (error) return voltar("erro");

  const pedidos = ((data ?? []) as Pedido[]).slice(0, POR_VEZ);
  if (pedidos.length === 0) return voltar("nada_a_fazer");

  let autorizadas = 0;
  let rejeitadas = 0;
  let semServico = 0;
  let ultimoMotivo = "";

  for (const p of pedidos) {
    let resposta: Response;
    try {
      resposta = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nota`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pedido_id: p.pedido_id, manual: true }),
        },
      );
    } catch {
      semServico += 1;
      continue;
    }

    // A função ainda não foi publicada: não adianta insistir nos outros.
    if (resposta.status === 404) {
      semServico = pedidos.length;
      break;
    }

    const corpo = (await resposta.json().catch(() => null)) as {
      ok?: boolean;
      motivo?: string;
    } | null;

    if (corpo?.ok) autorizadas += 1;
    else {
      rejeitadas += 1;
      ultimoMotivo = corpo?.motivo ?? "erro";
    }
  }

  revalidatePath("/expedicao");

  if (semServico === pedidos.length) return voltar("servico_nao_publicado");

  voltar(
    `${autorizadas}-${rejeitadas}${ultimoMotivo ? `-${encodeURIComponent(ultimoMotivo)}` : ""}`,
  );
}
