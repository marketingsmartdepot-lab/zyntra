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

  const [{ data: perfil }, { data: possiveis }] = await Promise.all([
    supabase.from("perfis").select("papel, permissoes").maybeSingle(),
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
  return FRENTES.find((f) => pode.has(f.permissao))?.href ?? null;
}
