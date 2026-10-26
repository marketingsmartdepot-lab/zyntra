import Link from "next/link";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { permissoesDeAgora } from "@/lib/permissoes";
import { noAparelho } from "@/lib/operador";
import { SimboloZ } from "@/components/marca";
import { sairDoAparelho } from "../identificar-acoes";

export const metadata = { title: "Separação — ZYNTRA" };

type Lista = {
  id: string;
  codigo: string;
  caixas: number;
  itens: number;
  lidos: number;
};

/**
 * Qual lista você vai separar.
 *
 * É a primeira tela de quem entra por PIN no celular, e por isso ela não tem
 * menu, nem filtro, nem coluna de dinheiro: a pessoa está em pé num corredor,
 * com o aparelho numa mão, e precisa de um toque para começar.
 *
 * Só listas em separação e no modo coletor aparecem — a de papel já saiu
 * impressa e não se bipa. Quem decide isso é o banco, não esta tela: a conta
 * do aparelho simplesmente não enxerga as outras.
 */
export default async function PaginaSeparacao() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar?destino=/separacao");

  const pode = await permissoesDeAgora();
  if (!pode.has("separar_no_coletor") && !pode.has("ver_expedicao")) {
    redirect("/");
  }

  const operador = await noAparelho();
  const { data } = await supabase.rpc("listas_do_coletor");
  const listas = (data ?? []) as Lista[];

  return (
    <main className="min-h-dvh bg-grafite px-5 py-7">
      <header className="mx-auto mb-6 flex max-w-[560px] items-center gap-3">
        <SimboloZ className="h-8 w-8" />
        <div className="flex-1">
          <h1 className="m-0 text-[19px] font-bold tracking-[-0.02em] text-offwhite">
            Separação
          </h1>
          {operador?.nome && (
            <p className="m-0 text-[12.5px] text-cinza-2">{operador.nome}</p>
          )}
        </div>

        {operador && (
          <form action={sairDoAparelho}>
            <input type="hidden" name="voltar" value="/separacao" />
            <button
              type="submit"
              className="rounded-lg border border-grafite-linha px-3 py-[7px] text-[12.5px] font-semibold text-cinza-2"
            >
              Sair
            </button>
          </form>
        )}
      </header>

      <div className="mx-auto flex max-w-[560px] flex-col gap-3">
        {listas.length === 0 ? (
          <div className="rounded-[12px] border border-grafite-linha bg-grafite-2 p-6 text-center">
            <p className="m-0 text-[15px] font-semibold text-offwhite">
              Nenhuma lista para separar
            </p>
            <p className="mx-auto mt-2 max-w-[42ch] text-[13px] leading-relaxed text-cinza-2">
              As listas aparecem aqui quando alguém gera uma em Separar
              escolhendo <b className="text-offwhite">Mandar pro coletor</b>.
            </p>
          </div>
        ) : (
          listas.map((l) => {
            const faltam = Math.max(l.itens - l.lidos, 0);
            const comecou = l.lidos > 0;

            return (
              <Link
                key={l.id}
                href={`/separacao/${l.id}`}
                className="flex items-center gap-4 rounded-[12px] border border-grafite-linha bg-grafite-2 px-5 py-4 no-underline"
              >
                <div className="flex-1">
                  <span className="block font-mono text-[16px] font-bold text-offwhite">
                    {l.codigo}
                  </span>
                  <span className="mt-[3px] block text-[12.5px] text-cinza-2">
                    {l.caixas} {l.caixas === 1 ? "caixa" : "caixas"} ·{" "}
                    {faltam === 0
                      ? "tudo separado"
                      : `${faltam} ${faltam === 1 ? "peça" : "peças"} a pegar`}
                  </span>
                </div>

                {comecou && faltam > 0 && (
                  <span className="rounded-full border border-champanhe/40 px-[10px] py-[3px] text-[11.5px] font-semibold text-champanhe">
                    começada
                  </span>
                )}

                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-cinza-2"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            );
          })
        )}
      </div>
    </main>
  );
}
