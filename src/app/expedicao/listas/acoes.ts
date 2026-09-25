"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina, turnoDaMaquina } from "@/lib/estacao";
import { listaDeSeparacao } from "@/lib/zpl";

/**
 * Gera a lista de separação a partir dos pacotes marcados em Separar.
 *
 * Gerar a lista é um ato só: o papel sai na impressora da bancada e os
 * pedidos já entram em Conferir. Não existe um "concluir" depois — no
 * corredor ninguém volta num computador para anunciar que terminou.
 *
 * Quem está no turno desta bancada fica gravado como separador. É o registro
 * que se consulta quando uma caixa some ou vem trocada.
 */
export async function gerarLista(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const turno = await turnoDaMaquina();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
    p_separador_id: turno?.operadorId ?? null,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    const motivo = error ? "erro" : r?.motivo;
    revalidatePath("/expedicao");
    redirect(`/expedicao?etapa=separar&falha=${motivo}`);
  }

  // A lista já existe e os pedidos já andaram. Se a impressão falhar, não se
  // desfaz nada: o papel se reimprime pela própria tela da lista.
  const impressao = await mandarParaImpressora(r.lista as string);

  revalidatePath("/expedicao");
  redirect(`/expedicao?etapa=listas&lista=${r.lista}&impressao=${impressao}`);
}

/**
 * Reimprime a folha de uma lista já emitida.
 *
 * Papel rasga, molha e cai atrás da prateleira. Sem isto a lista estaria
 * perdida, porque os pedidos dela já saíram de Separar e não dá para gerar
 * outra com os mesmos.
 */
export async function imprimirLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const estacao = await estacaoDaMaquina();
  if (!estacao) {
    redirect(
      `/bancada?destino=${encodeURIComponent(`/expedicao?etapa=listas&lista=${listaId}`)}`,
    );
  }

  const resultado = await mandarParaImpressora(listaId);
  revalidatePath("/expedicao");
  redirect(`/expedicao?etapa=listas&lista=${listaId}&impressao=${resultado}`);
}

/**
 * Monta o ZPL da folha e põe na fila da impressora desta bancada.
 *
 * O ZPL é montado aqui, no servidor, e vai pronto para a fila. O agente da
 * bancada não busca nada nem decide nada — recebe texto e imprime. Devolve o
 * motivo em vez de redirecionar, porque quem chama decide para onde ir.
 */
async function mandarParaImpressora(listaId: string): Promise<string> {
  const estacao = await estacaoDaMaquina();
  // Sem saber qual bancada é esta máquina não há em qual impressora mandar.
  // Quem gerou a lista descobre isso na tela e escolhe a bancada.
  if (!estacao) return "sem_bancada";

  const supabase = await criarClienteServidor();

  const [{ data: resumo }, { data: itens }] = await Promise.all([
    supabase.from("listas_resumo").select("*").eq("id", listaId).maybeSingle(),
    supabase
      .from("listas_itens")
      .select("codigo, descricao, unidades, pacotes")
      .eq("lista_id", listaId)
      .order("codigo"),
  ]);

  if (!resumo) return "lista_nao_encontrada";

  const cabecalho = resumo as {
    codigo: string;
    pacotes: number;
    unidades: number;
    separador: string | null;
  };

  const zpl = listaDeSeparacao(
    {
      codigo: cabecalho.codigo,
      pacotes: cabecalho.pacotes,
      unidades: cabecalho.unidades,
      separador: cabecalho.separador,
    },
    (itens ?? []) as {
      codigo: string;
      descricao: string | null;
      unidades: number;
      pacotes: number;
    }[],
  );

  const turno = await turnoDaMaquina();

  const { data, error } = await supabase.rpc("solicitar_impressao", {
    p_tipo: "lista_separacao",
    p_conteudo: zpl,
    p_lista_id: listaId,
    p_estacao_id: estacao,
    p_operador_id: turno?.operadorId ?? null,
  });

  if (error) return "erro";

  const r = Array.isArray(data) ? data[0] : data;
  return r?.ok ? "ok" : (r?.motivo ?? "erro");
}
