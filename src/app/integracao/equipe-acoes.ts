"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

const VOLTAR = "/integracao?aba=equipe";

function encerrar(falha?: string) {
  revalidatePath("/integracao");
  redirect(falha ? `${VOLTAR}&falha=${falha}` : VOLTAR);
}

/**
 * Libera um e-mail a usar o ZYNTRA.
 *
 * A autorização é por e-mail, não por convite enviado: quem cria a senha é a
 * própria pessoa, e o sistema só reconhece quem já estava nesta lista. Quem
 * não está pode até criar um login — nasce inativo e não enxerga nada.
 */
export async function autorizarPessoa(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const papel = String(formData.get("papel") ?? "operador");
  const nome = String(formData.get("nome") ?? "").trim();
  if (!email) return encerrar("email_invalido");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("autorizar_pessoa", {
    p_email: email,
    p_papel: papel,
    p_nome: nome || null,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/** Corta o acesso agora e apaga a autorização. */
export async function revogarPessoa(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  if (!email) return encerrar("email_invalido");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("revogar_pessoa", {
    p_email: email,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

export async function definirPapel(formData: FormData) {
  const perfil = String(formData.get("perfil") ?? "");
  const papel = String(formData.get("papel") ?? "");
  if (!perfil || !papel) return encerrar("erro");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("definir_papel_perfil", {
    p_perfil_id: perfil,
    p_papel: papel,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/**
 * Cadastra alguém que trabalha na bancada e não tem login.
 *
 * Nasce sem PIN de propósito: o PIN vai por um campo do tipo senha, com a
 * pessoa do lado, e não no mesmo envio em que se digita o nome dela em voz
 * alta para alguém do outro lado da mesa.
 */
export async function criarPessoaNaBancada(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const papel = String(formData.get("papel") ?? "operador");
  if (!nome) return encerrar("nome_vazio");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("criar_pessoa_na_bancada", {
    p_nome: nome,
    p_papel: papel,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? "pessoa_criada" : r?.motivo);
}

/** O PIN vai por POST e nunca pela URL, e o campo é do tipo senha. */
export async function definirPin(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const pin = String(formData.get("pin") ?? "");
  if (!operador) return;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("definir_pin_operador", {
    p_operador_id: operador,
    p_pin: pin,
  });

  encerrar(
    !error
      ? "pin_ok"
      : error.message.includes("4 a 8")
        ? "pin_formato"
        : "sem_permissao",
  );
}

/** Liga e desliga o acesso de bancada de quem não tem login. */
export async function ligarBancada(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const ativo = String(formData.get("ativo") ?? "") === "1";
  if (!operador) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("bancada_ativa", {
    p_operador_id: operador,
    p_ativo: ativo,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/**
 * Destrava quem errou o PIN. Sem isto a única saída seria esperar dez minutos
 * parado — e num galpão dez minutos de bancada parada é fila.
 */
export async function destravarBancada(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  if (!operador) return;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("destravar_bancada", {
    p_operador_id: operador,
  });

  const r = Array.isArray(data) ? data[0] : data;
  encerrar(error ? "erro" : r?.ok ? undefined : r?.motivo);
}

/**
 * Define o que uma pessoa enxerga e faz.
 *
 * A tela manda a lista inteira, não uma marcação por vez: desmarcar é tão
 * importante quanto marcar, e um envio por caixinha faria a pessoa clicar
 * dez vezes para tirar dez permissões.
 *
 * A lista mistura permissões que moram em duas tabelas — a bipagem é do
 * operador de bancada, o resto é do perfil. Quem separa é a função do banco:
 * a tela não deveria saber onde cada uma dorme.
 */
export async function definirPermissoes(formData: FormData) {
  const pessoa = String(formData.get("pessoa") ?? "");
  if (!pessoa) return;

  const permissoes = formData.getAll("permissao").map(String).filter(Boolean);

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("definir_permissoes", {
    p_pessoa: pessoa,
    p_permissoes: permissoes,
  });

  revalidatePath("/integracao");

  const r = Array.isArray(data) ? data[0] : data;
  redirect(
    `/integracao?aba=equipe&falha=${
      error ? "erro" : r?.ok ? "permissoes_salvas" : (r?.motivo ?? "erro")
    }`,
  );
}
