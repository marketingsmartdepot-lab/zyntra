"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { noAparelho } from "@/lib/operador";

/** Um bipe no corredor. Volta para a mesma tela, com o resultado no endereço. */
export async function biparSeparacao(formData: FormData) {
  const lista = String(formData.get("lista") ?? "");
  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!lista) return;
  if (!codigo) redirect(`/separacao/${lista}`);

  const quem = await noAparelho();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("bipar_separacao", {
    p_lista_id: lista,
    p_codigo: codigo,
    p_operador_id: quem?.id ?? null,
  });

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/separacao/${lista}`);

  if (error) redirect(`/separacao/${lista}?r=erro`);

  // O ambíguo precisa dos candidatos na volta: é a pessoa que decide qual
  // produto pegou, e ela só decide se vir os dois.
  if (r?.motivo === "ambiguo") {
    redirect(
      `/separacao/${lista}?r=ambiguo&codigo=${encodeURIComponent(codigo)}` +
        `&entre=${encodeURIComponent(JSON.stringify(r.candidatos ?? []))}`,
    );
  }

  redirect(
    `/separacao/${lista}?r=${r?.motivo ?? "erro"}` +
      `&codigo=${encodeURIComponent(r?.codigo ?? codigo)}` +
      (r?.descricao ? `&nome=${encodeURIComponent(r.descricao)}` : "") +
      (r?.ok ? `&sep=${r.separado}&esp=${r.esperado}` : ""),
  );
}

/** A pessoa apontou qual produto era, quando o código servia para dois. */
export async function escolherNaSeparacao(formData: FormData) {
  const lista = String(formData.get("lista") ?? "");
  const sku = String(formData.get("sku") ?? "");
  if (!lista || !sku) return;

  const quem = await noAparelho();

  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("somar_na_separacao", {
    p_lista_id: lista,
    p_sku_id: sku,
    p_operador_id: quem?.id ?? null,
  });

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/separacao/${lista}`);

  redirect(
    `/separacao/${lista}?r=${r?.motivo ?? "erro"}` +
      (r?.codigo ? `&codigo=${encodeURIComponent(r.codigo)}` : "") +
      (r?.descricao ? `&nome=${encodeURIComponent(r.descricao)}` : "") +
      (r?.ok ? `&sep=${r.separado}&esp=${r.esperado}` : ""),
  );
}

/**
 * Fecha a separação e manda os pedidos para Conferir.
 *
 * Trava até estar tudo verde, por decisão dela: caixa certa vale mais que
 * corredor livre.
 */
export async function fecharSeparacao(formData: FormData) {
  const lista = String(formData.get("lista") ?? "");
  if (!lista) return;

  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("fechar_separacao", { p_lista_id: lista });

  const r = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/separacao/${lista}`);
  revalidatePath("/expedicao");

  if (!r?.ok) redirect(`/separacao/${lista}?r=${r?.motivo ?? "erro"}`);

  redirect(`/separacao/${lista}?r=fechada&pedidos=${r.pedidos}`);
}
