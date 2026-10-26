import { criarClienteServidor } from "@/lib/supabase/server";
import { FRENTES, type Frente } from "@/lib/frentes";

export { FRENTES, type Frente };

/** A permissão que abre cada frente. */
export const FRENTE_PERMISSAO: Record<string, string> = Object.fromEntries(
  FRENTES.map((f) => [f.chave, f.permissao]),
);

/**
 * O que a pessoa de agora pode.
 *
 * Uma consulta só, e não uma por pergunta: a lateral precisa saber de cinco
 * frentes de uma vez, e cinco idas ao banco para desenhar um menu é desperdício
 * que aparece em toda navegação.
 *
 * Administrador volta com tudo — é a dona, e a régua dela não depende de
 * alguém ter lembrado de marcar uma caixinha.
 */
export async function permissoesDeAgora(): Promise<Set<string>> {
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Set();

  // O `where` é EXPLÍCITO, e isso não é redundância com a RLS.
  //
  // Esta consulta já foi `select(...).maybeSingle()` sem filtro, confiando na
  // política para devolver exatamente uma linha. Funcionou enquanto só havia
  // um perfil no sistema: para um administrador, que enxerga todos, "todos" e
  // "o meu" eram a mesma linha.
  //
  // No dia em que nasceu o segundo perfil, `maybeSingle()` passou a receber
  // duas linhas — e com duas linhas ele não devolve a primeira, devolve erro.
  // O perfil veio nulo, o conjunto de permissões veio vazio, e a tela disse
  // "Nenhuma frente está liberada" para a dona do sistema. Em 26/10 isso
  // aconteceu de verdade, e quem inseriu a segunda linha fui eu.
  //
  // Política é guarda, não é cláusula de busca. Quando as duas coisas se
  // confundem, o sistema fica certo por coincidência.
  const [{ data: perfil }, { data: possiveis }] = await Promise.all([
    supabase
      .from("perfis")
      .select("papel, permissoes")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("permissoes_possiveis"),
  ]);

  const p = perfil as { papel: string; permissoes: string[] | null } | null;
  const todas = ((possiveis ?? []) as { chave: string }[]).map((x) => x.chave);

  if (!p) return new Set();
  if (p.papel === "admin") return new Set(todas);

  return new Set(p.permissoes ?? []);
}

/**
 * A primeira frente que esta pessoa consegue abrir.
 *
 * É para onde a raiz manda quem entra. Mandar todo mundo para a Expedição
 * fazia quem só enxerga o Painel bater numa porta trancada a cada login.
 * `null` quando não há nenhuma.
 */
export async function primeiraFrenteAberta(): Promise<string | null> {
  const pode = await permissoesDeAgora();
  const frente = FRENTES.find((f) => pode.has(f.permissao))?.href;
  if (frente) return frente;

  // A separação no coletor não é uma frente do menu — de propósito: quem
  // entra por PIN no celular não navega, ele separa. Mas a raiz precisa saber
  // para onde mandar essa pessoa, senão ela entra e bate numa porta trancada
  // logo depois de digitar o PIN certo.
  return pode.has("separar_no_coletor") ? "/separacao" : null;
}
