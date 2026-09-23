"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const voltar = (r: string) => redirect(`/integracao?aba=cadastros&falha=${r}`);

function traduzir(mensagem: string) {
  if (mensagem.includes("row-level security")) return "sem_permissao";
  if (mensagem.includes("duplicate key")) return "ja_existe";
  return "erro";
}

/** Quem emite a nota. Sem empresa emissora, a conta não fatura. */
export async function criarEmpresa(formData: FormData) {
  const razao = String(formData.get("razao_social") ?? "").trim();
  const curto = String(formData.get("nome_curto") ?? "").trim();
  if (!razao || !curto) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("empresas").insert({
    razao_social: razao,
    nome_curto: curto,
    cnpj: String(formData.get("cnpj") ?? "").replace(/\D/g, "") || null,
    serie_nfe: String(formData.get("serie_nfe") ?? "").trim() || null,
    faturador_situacao: String(formData.get("faturador") ?? "nao_configurado"),
  });

  revalidatePath("/integracao");
  voltar(error ? traduzir(error.message) : "empresa_criada");
}

export async function atualizarFaturador(formData: FormData) {
  const id = String(formData.get("empresa") ?? "");
  if (!id) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("empresas")
    .update({
      faturador_situacao: String(formData.get("faturador") ?? "nao_configurado"),
      serie_nfe: String(formData.get("serie_nfe") ?? "").trim() || null,
    })
    .eq("id", id);

  revalidatePath("/integracao");
  voltar(error ? traduzir(error.message) : "empresa_salva");
}

/**
 * O canal. `entra_na_esteira` desligado é o caso do Full: a mercadoria está no
 * galpão do Mercado Livre, então nada disso passa por aqui.
 */
export async function criarCanal(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (!nome || !slug) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("canais").insert({
    slug,
    nome,
    sigla: String(formData.get("sigla") ?? "").trim().toUpperCase() || null,
    icone_url: String(formData.get("icone_url") ?? "").trim() || null,
    entra_na_esteira: formData.get("entra_na_esteira") !== null,
  });

  revalidatePath("/integracao");
  voltar(error ? traduzir(error.message) : "canal_criado");
}

/**
 * A modalidade de envio. Três chaves mudam o comportamento da esteira:
 * se gera etiqueta, se exige nota antes, e se tem janela de coleta.
 */
export async function criarModalidade(formData: FormData) {
  const canal = String(formData.get("canal") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (!canal || !nome || !slug) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("modalidades").insert({
    canal_id: canal,
    slug,
    nome,
    gera_etiqueta: formData.get("gera_etiqueta") !== null,
    exige_nota_antes: formData.get("exige_nota_antes") !== null,
    tem_janela_coleta: formData.get("tem_janela_coleta") !== null,
    entra_na_esteira: formData.get("entra_na_esteira") !== null,
  });

  revalidatePath("/integracao");
  voltar(error ? traduzir(error.message) : "modalidade_criada");
}

/**
 * O custo da etiqueta. Abre uma vigência nova e fecha a anterior — nunca
 * sobrescreve, porque o valor congelado numa saída antiga precisa continuar
 * explicável no fechamento do mês.
 */
export async function definirCusto(formData: FormData) {
  const modalidade = String(formData.get("modalidade") ?? "");
  const valor = Number(String(formData.get("valor") ?? "").replace(",", "."));
  const desde = String(formData.get("vigente_de") ?? "").trim();
  if (!modalidade || !Number.isFinite(valor)) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("definir_custo_etiqueta", {
    p_modalidade_id: modalidade,
    p_valor: valor,
    p_vigente_de: desde || new Date().toISOString().slice(0, 10),
  });

  const r = Array.isArray(data) ? data[0] : data;

  revalidatePath("/integracao");
  revalidatePath("/logistica");
  voltar(error ? "erro" : r?.ok ? "custo_salvo" : (r?.motivo ?? "erro"));
}
