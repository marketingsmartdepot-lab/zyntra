"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";
import { listaDeSeparacao } from "@/lib/zpl";

export async function gerarLista(formData: FormData) {
  const ids = formData.getAll("pacote").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_lista", {
    p_pacote_ids: ids,
  });

  const r = Array.isArray(data) ? data[0] : data;

  if (error || !r?.ok) {
    const motivo = error ? "erro" : r?.motivo;
    revalidatePath("/expedicao");
    redirect(`/expedicao?etapa=separar&falha=${motivo}`);
  }

  revalidatePath("/expedicao");
  redirect(`/expedicao?etapa=listas&lista=${r.lista}`);
}

export async function concluirLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const supabase = await criarClienteServidor();
  await supabase.rpc("concluir_lista", { p_lista_id: listaId });

  revalidatePath("/expedicao");
  redirect("/expedicao?etapa=conferir");
}

/**
 * Manda a folha de separação para a impressora da bancada.
 *
 * O ZPL é montado aqui, no servidor, e vai pronto para a fila. O agente da
 * bancada não busca nada nem decide nada — recebe texto e imprime. É o mesmo
 * caminho que a etiqueta do Mercado Livre vai usar, com a diferença de que a
 * etiqueta precisa ser buscada no ML antes; esta folha é só dado nosso.
 */
export async function imprimirLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const voltar = (resultado: string) =>
    redirect(`/expedicao?etapa=listas&lista=${listaId}&impressao=${resultado}`);

  const estacao = await estacaoDaMaquina();
  if (!estacao) {
    // Sem saber qual bancada é esta máquina não há em qual impressora mandar.
    redirect(
      `/bancada?destino=${encodeURIComponent(`/expedicao?etapa=listas&lista=${listaId}`)}`,
    );
  }

  const supabase = await criarClienteServidor();

  const [{ data: resumo }, { data: itens }] = await Promise.all([
    supabase.from("listas_resumo").select("*").eq("id", listaId).maybeSingle(),
    supabase
      .from("listas_itens")
      .select("codigo, descricao, unidades, pacotes")
      .eq("lista_id", listaId)
      .order("codigo"),
  ]);

  if (!resumo) return voltar("lista_nao_encontrada");

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

  const { data, error } = await supabase.rpc("solicitar_impressao", {
    p_tipo: "lista_separacao",
    p_conteudo: zpl,
    p_lista_id: listaId,
    p_estacao_id: estacao,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath("/expedicao");
  voltar(r?.ok ? "ok" : (r?.motivo ?? "erro"));
}

export async function iniciarLista(formData: FormData) {
  const listaId = String(formData.get("lista") ?? "");
  if (!listaId) return;

  const supabase = await criarClienteServidor();
  await supabase
    .from("listas_separacao")
    .update({ situacao: "em_execucao", iniciada_em: new Date().toISOString() })
    .eq("id", listaId)
    .eq("situacao", "aguardando");

  revalidatePath("/expedicao");
}
