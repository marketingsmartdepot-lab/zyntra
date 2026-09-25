"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

type Bloco = {
  ok: boolean;
  motivo: string;
  detalhe: string | null;
  proxima_pagina: number;
  tem_mais: boolean;
  produtos: number;
  criados: number;
  casados: number;
  ja_estavam: number;
  sem_codigo: number;
  inativos: number;
  codigos_repetidos: string[] | null;
};

/** Teto de blocos. 20 blocos de 8 páginas cobrem 16 mil produtos. */
const MAX_BLOCOS = 20;

/**
 * Traz o catálogo do Bling.
 *
 * O catálogo inteiro leva mais tempo do que uma requisição ao banco pode
 * durar, então a sincronização vem em blocos de páginas e é esta ação que os
 * encadeia — aqui a folga de tempo é maior. Cada bloco já grava o que trouxe,
 * então uma queda no meio não perde o que entrou: rodar de novo continua.
 */
export async function sincronizarCatalogo() {
  const supabase = await criarClienteServidor();

  let pagina = 1;
  const soma = {
    produtos: 0,
    criados: 0,
    casados: 0,
    ja_estavam: 0,
    sem_codigo: 0,
    inativos: 0,
  };
  const repetidos = new Set<string>();

  for (let bloco = 0; bloco < MAX_BLOCOS; bloco++) {
    const { data, error } = await supabase.rpc("sincronizar_catalogo_erp", {
      p_pagina_inicial: pagina,
      p_paginas: 8,
    });

    if (error) return encerrar("erro");

    const r = (Array.isArray(data) ? data[0] : data) as Bloco | null;
    if (!r) return encerrar("erro");

    soma.produtos += r.produtos;
    soma.criados += r.criados;
    soma.casados += r.casados;
    soma.ja_estavam += r.ja_estavam;
    soma.sem_codigo += r.sem_codigo;
    soma.inativos += r.inativos;
    for (const c of r.codigos_repetidos ?? []) repetidos.add(c);

    // Falha no meio: o que entrou está gravado, e o motivo é dito por inteiro.
    if (!r.ok) return encerrar(r.motivo, soma, repetidos.size);

    if (!r.tem_mais) return encerrar("ok", soma, repetidos.size);
    pagina = r.proxima_pagina;
  }

  // Estourou o teto: catálogo maior do que o previsto. Rodar de novo continua.
  return encerrar("parcial", soma, repetidos.size);
}

function encerrar(
  resultado: string,
  soma?: { produtos: number; criados: number; casados: number; sem_codigo: number },
  repetidos?: number,
): never {
  revalidatePath("/integracao");

  const p = new URLSearchParams({ aba: "catalogo", sincronia: resultado });
  if (soma) {
    p.set("lidos", String(soma.produtos));
    p.set("criados", String(soma.criados));
    p.set("casados", String(soma.casados));
    if (soma.sem_codigo > 0) p.set("sem_codigo", String(soma.sem_codigo));
    if (repetidos) p.set("repetidos", String(repetidos));
  }

  redirect(`/integracao?${p.toString()}`);
}
