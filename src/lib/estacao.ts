import { cookies } from "next/headers";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Qual bancada é ESTA máquina.
 *
 * Cookie e não escolha em tela: a bancada não muda: o computador fica
 * parafusado na mesa ao lado da impressora. Perguntar de novo a cada impressão
 * seria pedir para o operador errar com pressa — e errar aqui significa a
 * etiqueta sair na impressora da outra ponta do galpão.
 *
 * Por ser cookie, o servidor já renderiza sabendo, sem piscar, e sobrevive a
 * reiniciar o navegador.
 */
export const COOKIE_ESTACAO = "zyntra_estacao";

export async function estacaoDaMaquina(): Promise<string | null> {
  const jar = await cookies();
  const valor = jar.get(COOKIE_ESTACAO)?.value?.trim();
  return valor ? valor : null;
}

export type Turno = {
  estacaoId: string;
  sessaoId: string;
  operadorId: string;
  operador: string;
};

/**
 * Quem está trabalhando nesta máquina agora.
 *
 * O turno não é decoração: é o que faz cada bipe, cada conferência e cada
 * liberação ter dono. Sem ele o histórico registra que algo aconteceu, mas
 * não quem fez — e um galpão sem isso não consegue resolver divergência
 * nenhuma no dia seguinte.
 *
 * Vem do banco e não de cookie: o turno é da BANCADA, não do navegador. Se o
 * operador abrir o turno numa aba, a outra aba da mesma máquina também sabe.
 */
export async function turnoDaMaquina(): Promise<Turno | null> {
  const estacaoId = await estacaoDaMaquina();
  if (!estacaoId) return null;

  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("turnos_abertos")
    .select("id, operador_id, operador")
    .eq("estacao_id", estacaoId)
    .maybeSingle();

  const t = data as { id: string; operador_id: string; operador: string } | null;
  if (!t) return null;

  return {
    estacaoId,
    sessaoId: t.id,
    operadorId: t.operador_id,
    operador: t.operador,
  };
}
