"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Liga e desliga a emissão automática de UMA conta.
 *
 * Uma de cada vez, de propósito. Emitir nota é irreversível — o Mercado Livre
 * não tem endpoint de cancelamento, só o painel — então ligar treze contas de
 * uma vez seria transformar um erro de cadastro em treze CNPJs com nota errada
 * no SEFAZ. Liga-se uma, olha-se o resultado, liga-se a próxima.
 */
export async function alternarEmissao(formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  const ligar = String(formData.get("ligar") ?? "") === "1";
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("contas")
    .update({ emissao_automatica: ligar })
    .eq("id", conta);

  revalidatePath("/integracao");

  if (error) {
    redirect(
      `/integracao?aba=contas&falha=${
        error.message.includes("row-level security") ? "sem_permissao" : "erro"
      }`,
    );
  }

  redirect(`/integracao?aba=contas&falha=${ligar ? "emissao_ligada" : "emissao_desligada"}`);
}

/**
 * Diz qual empresa emite a nota desta conta.
 *
 * Faltava: a tela criava a empresa em Cadastros e mostrava qual estava
 * amarrada, mas nenhum caminho GRAVAVA a amarração — todos só liam. Sem ela
 * `solicitar_nota` recusa tudo com `faturador_nao_configurado` e devolve o
 * pacote de Faturado para Aberto.
 *
 * É a empresa que decide CNPJ e série da nota, então trocar com pedido no
 * meio do caminho troca o emissor do que ainda não foi emitido. Por isso a
 * tela pede confirmação antes.
 */
export async function definirEmpresaEmissora(formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  const empresa = String(formData.get("empresa") ?? "");
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("contas")
    .update({ empresa_emissora_id: empresa || null })
    .eq("id", conta);

  revalidatePath("/integracao");
  revalidatePath("/expedicao");

  redirect(
    `/integracao?aba=contas&falha=${
      error
        ? error.message.includes("row-level security")
          ? "sem_permissao"
          : "erro"
        : empresa
          ? "emissora_definida"
          : "emissora_removida"
    }`,
  );
}

/**
 * Religa a emissão de uma conta que o disjuntor pausou.
 *
 * Não é só apertar o botão: o disjuntor pausou porque a mesma rejeição se
 * repetiu, e a causa está fora daqui — no cadastro fiscal do produto ou nas
 * regras da conta. Retomar sem consertar faz a conta pausar de novo em
 * minutos, e é isso que a tela diz.
 */
export async function retomarEmissao(formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("retomar_emissao", {
    p_conta_id: conta,
  });

  const r = Array.isArray(data) ? data[0] : data;

  revalidatePath("/integracao");
  redirect(
    `/integracao?aba=contas&falha=${
      error ? "erro" : r?.ok ? "emissao_retomada" : (r?.motivo ?? "erro")
    }`,
  );
}
