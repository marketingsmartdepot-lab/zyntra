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
