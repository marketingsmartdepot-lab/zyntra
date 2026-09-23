"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function salvarDeposito(formData: FormData) {
  const deposito = String(formData.get("deposito") ?? "").trim();
  const ativo = formData.get("ativo") !== null;

  const supabase = await criarClienteServidor();

  const { data: antes } = await supabase
    .from("erp_config")
    .select("ativo")
    .maybeSingle();

  const { error } = await supabase
    .from("erp_config")
    .update({
      deposito_ref: deposito || null,
      ativo,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", true);

  revalidatePath("/integracao");

  if (error) {
    redirect(
      `/integracao?aba=estoque&falha=${
        error.message.includes("row-level security") ? "sem_permissao" : "erro"
      }`,
    );
  }

  // Ligar e desligar o envio é a mudança que muda o comportamento; o
  // depósito é só um dado. Por isso a mensagem fala do que mudou de fato.
  const mudouChave = (antes as { ativo: boolean } | null)?.ativo !== ativo;

  redirect(
    `/integracao?aba=estoque&falha=${
      mudouChave ? (ativo ? "erp_ligado" : "erp_desligado") : "deposito_salvo"
    }`,
  );
}

/**
 * Devolve para a fila as baixas que falharam.
 *
 * Não tenta enviar aqui: só recoloca em `pendente`. Quem envia é o serviço que
 * drena a fila — misturar as duas coisas faria um clique virar trinta chamadas
 * ao Bling dentro de uma requisição de tela.
 */
export async function tentarBaixaDeNovo() {
  const supabase = await criarClienteServidor();

  await supabase
    .from("baixas_estoque")
    .update({ situacao: "pendente", erro: null })
    .eq("situacao", "erro");

  revalidatePath("/integracao");
  redirect("/integracao?aba=estoque&falha=refila");
}

/**
 * Puxa o catálogo do Bling e casa com os SKUs pelo código.
 *
 * Sem isto `skus.erp_ref` fica vazio e toda baixa falha dizendo "SKU sem
 * referência no Bling". É pré-requisito da baixa, não um extra.
 */
export async function sincronizarCatalogo() {
  const supabase = await criarClienteServidor();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/integracao?aba=estoque&falha=sem_sessao");

  let resposta: Response;
  try {
    resposta = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/catalogo`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
  } catch {
    redirect("/integracao?aba=estoque&falha=servico_indisponivel");
  }

  if (resposta.status === 404) {
    redirect("/integracao?aba=estoque&falha=servico_nao_publicado");
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    ok?: boolean;
    motivo?: string;
    casados?: number;
    sem_referencia?: number;
  } | null;

  revalidatePath("/integracao");

  redirect(
    corpo?.ok
      ? `/integracao?aba=estoque&falha=catalogo-${corpo.casados ?? 0}-${corpo.sem_referencia ?? 0}`
      : `/integracao?aba=estoque&falha=${corpo?.motivo ?? "erro"}`,
  );
}
