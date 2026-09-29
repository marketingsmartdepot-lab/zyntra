import { cookies } from "next/headers";

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
