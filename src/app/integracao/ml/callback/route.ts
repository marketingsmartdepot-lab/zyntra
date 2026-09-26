import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * O endereço de retorno do Mercado Livre.
 *
 * É este que se cadastra no aplicativo, no DevCenter, e ele tem de bater
 * EXATAMENTE — o ML recusa qualquer diferença, inclusive uma barra a mais.
 * Por isso ele não pode carregar nada variável: quem diz qual conta está
 * sendo conectada é o `state`, não a URL.
 *
 * A troca acontece aqui, no servidor, no mesmo instante: o código de
 * autorização é de uso único, e usá-lo duas vezes devolve `invalid_grant`.
 * Quem garante que a segunda passagem morre antes de qualquer chamada de rede
 * é o `state`, consumido dentro do banco.
 */
export async function GET(request: NextRequest) {
  const parametros = request.nextUrl.searchParams;
  const destino = new URL("/integracao", request.nextUrl.origin);
  destino.searchParams.set("aba", "contas");

  const voltar = (ml: string) => {
    destino.searchParams.set("ml", ml);
    return NextResponse.redirect(destino);
  };

  // O ML avisa a recusa na própria volta, quando a pessoa cancela.
  if (parametros.get("error")) return voltar("recusado_no_ml");

  const code = parametros.get("code");
  const state = parametros.get("state");
  if (!code || !state) return voltar("retorno_incompleto");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("concluir_oauth_conta", {
    p_estado: state,
    p_code: code,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  return voltar(r?.ok ? "ok" : (r?.motivo ?? "erro"));
}
