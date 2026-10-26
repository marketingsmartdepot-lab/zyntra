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
 * Liga e desliga a baixa de estoque no Bling de UMA conta.
 *
 * Uma de cada vez porque o corte da Lexos é conta por conta. Enquanto a Lexos
 * ainda manda os pedidos de uma conta para o Bling, ligar esta chave faria os
 * dois baixarem a mesma peça — e estoque errado no Bling se corrige na mão lá
 * dentro.
 *
 * Só vale para vendas que chegarem DEPOIS de ligar. As que já entraram não
 * são baixadas, e isso é de propósito: a Lexos já baixou aquelas.
 */
export async function alternarBaixaEstoque(formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  const ligar = String(formData.get("ligar") ?? "") === "1";
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("contas")
    .update({ baixa_estoque_automatica: ligar })
    .eq("id", conta);

  revalidatePath("/integracao");

  redirect(
    `/integracao?aba=contas&falha=${
      error
        ? error.message.includes("row-level security")
          ? "sem_permissao"
          : "erro"
        : ligar
          ? "baixa_ligada"
          : "baixa_desligada"
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

/**
 * A partir de quando esta conta traz pedidos.
 *
 * O chão, escolhido por gente: nunca entra pedido criado antes desta data. Ao
 * conectar uma conta ela recebe a hora da conexão, que é o que faz conta nova
 * não despejar meses de histórico na esteira.
 *
 * Só a data, sem hora: quem decide isso pensa em dias ("a partir de hoje", "a
 * partir de segunda"), e pedir hora seria precisão falsa.
 */
export async function definirImportarDesde(formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  const desde = String(formData.get("desde") ?? "").trim();
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("contas")
    // Campo vazio = sem chão: volta a valer só o teto de 7 dias da varredura.
    .update({ importar_desde: desde ? `${desde}T00:00:00-03:00` : null })
    .eq("id", conta);

  revalidatePath("/integracao");
  redirect(
    `/integracao?aba=contas&falha=${
      error
        ? error.message.includes("row-level security")
          ? "sem_permissao"
          : "erro"
        : "corte_salvo"
    }`,
  );
}

/**
 * Para e volta a trazer pedidos de uma conta, sem desconectar.
 *
 * Desconectar resolveria, mas perde o token e obriga a refazer o OAuth no
 * Mercado Livre depois — caro demais para uma pausa de alguns dias.
 *
 * `pausar` vem amarrado na ação e não num campo do formulário: o name/value de
 * um botão de envio não chega de forma confiável numa Server Action, e o
 * sintoma é o pior possível — a ação roda, não recebe nada, e volta calada.
 * Mesmo erro que já me pegou na escolha da bancada e no "mandar pro coletor".
 */
export async function pausarImportacao(pausar: boolean, formData: FormData) {
  const conta = String(formData.get("conta") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!conta) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("pausar_importacao", {
    p_conta_id: conta,
    p_pausar: pausar,
    p_motivo: motivo || null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  revalidatePath("/integracao");
  redirect(
    `/integracao?aba=contas&falha=${
      error
        ? "erro"
        : r?.ok
          ? pausar
            ? "entrada_pausada"
            : "entrada_religada"
          : (r?.motivo ?? "erro")
    }`,
  );
}
