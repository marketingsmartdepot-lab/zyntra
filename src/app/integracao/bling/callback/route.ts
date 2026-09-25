import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * O endereço de retorno do Bling. É este que se cadastra no aplicativo, lá no
 * painel de desenvolvedor — o Bling não aceita um redirect passado na hora.
 *
 * Duas coisas governam o que acontece aqui, e as duas vêm da API do Bling:
 *
 *   1. O código de autorização vale por UM minuto. Por isso a troca acontece
 *      no servidor, no mesmo instante, sem passar pelo navegador.
 *   2. Usar o mesmo código duas vezes não dá erro — o Bling REVOGA o acesso.
 *      Então a segunda passagem (alguém atualiza a página) precisa morrer
 *      antes de qualquer chamada. Quem garante isso é o `state`, consumido
 *      dentro do banco na primeira vez.
 */
export async function GET(request: NextRequest) {
  const parametros = request.nextUrl.searchParams;
  const destino = new URL("/integracao", request.nextUrl.origin);
  destino.searchParams.set("aba", "estoque");

  const voltar = (bling: string) => {
    destino.searchParams.set("bling", bling);
    return NextResponse.redirect(destino);
  };

  // O Bling avisa a recusa na própria volta, quando a pessoa cancela.
  const recusa = parametros.get("error");
  if (recusa) return voltar("recusado_no_bling");

  const code = parametros.get("code");
  const state = parametros.get("state");
  if (!code || !state) return voltar("retorno_incompleto");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("concluir_oauth_erp", {
    p_estado: state,
    p_code: code,
  });

  if (error) return voltar("erro");

  const r = Array.isArray(data) ? data[0] : data;
  return voltar(r?.ok ? "ok" : (r?.motivo ?? "erro"));
}
