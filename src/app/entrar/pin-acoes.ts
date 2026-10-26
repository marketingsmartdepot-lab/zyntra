"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { COOKIE_OPERADOR } from "@/lib/operador";

/**
 * Entrar no aparelho com nome e PIN, sem e-mail e sem senha.
 *
 * Tudo acontece AQUI, no servidor, e não no navegador do celular. A Edge
 * Function devolve uma sessão pronta; se essa resposta passasse pelo
 * JavaScript da página, o token ficaria ao alcance de quem abrisse o console
 * — e celular de galpão é o aparelho mais fácil de alguém pegar emprestado.
 * Assim o que chega ao celular é só o cookie, como em qualquer login.
 *
 * Duas identidades são gravadas, e elas respondem perguntas diferentes:
 *
 *   a SESSÃO é da conta do aparelho, que só enxerga a separação;
 *   o COOKIE do operador diz QUEM está com ele na mão agora, e é esse nome
 *   que assina o que for separado.
 */
export async function entrarPorPin(formData: FormData) {
  const operador = String(formData.get("operador") ?? "");
  const pin = String(formData.get("pin") ?? "");

  const voltar = (motivo: string) => redirect(`/entrar?porta=${motivo}`);

  if (!operador || !pin) return voltar("faltou");

  let resposta: Response;
  try {
    resposta = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/estacao`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        },
        body: JSON.stringify({ operador_id: operador, pin }),
      },
    );
  } catch {
    return voltar("servico_indisponivel");
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    ok?: boolean;
    motivo?: string;
    sessao?: { access_token: string; refresh_token: string };
  } | null;

  if (!corpo?.ok || !corpo.sessao) {
    return voltar(corpo?.motivo ?? "erro");
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.setSession({
    access_token: corpo.sessao.access_token,
    refresh_token: corpo.sessao.refresh_token,
  });

  if (error) return voltar("nao_abriu_a_sessao");

  (await cookies()).set(COOKIE_OPERADOR, operador, {
    path: "/",
    // Doze horas: um turno. Mais que isso e o aparelho amanheceria no nome de
    // quem foi embora ontem.
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
  });

  redirect("/separacao");
}
