import { redirect } from "next/navigation";
import { Logotipo, Rodape, SimboloZ } from "@/components/marca";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";
import { definirBancada } from "./acoes";

export const metadata = { title: "Qual bancada é esta — ZYNTRA" };

type Estacao = {
  id: string;
  nome: string;
  local: string | null;
  impressora: string | null;
};

export default async function PaginaBancada({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/bancada");

  const { destino } = await searchParams;
  const paraOnde =
    destino && destino.startsWith("/") && !destino.startsWith("//")
      ? destino
      : "/expedicao";

  const atual = await estacaoDaMaquina();

  const { data } = await supabase
    .from("estacoes")
    .select("id, nome, local, impressoras ( nome )")
    .order("nome");

  const bancadas: Estacao[] = (data ?? []).map((e) => {
    const linha = e as {
      id: string;
      nome: string;
      local: string | null;
      impressoras: { nome: string }[] | null;
    };
    return {
      id: linha.id,
      nome: linha.nome,
      local: linha.local,
      impressora: linha.impressoras?.[0]?.nome ?? null,
    };
  });

  return (
    <main className="flex min-h-dvh flex-col bg-grafite text-offwhite">
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[560px]">
          <div className="mb-8 flex items-center gap-3">
            <SimboloZ className="block h-[34px] w-[34px]" />
            <Logotipo className="block h-[17px] w-auto text-offwhite" />
          </div>

          <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">
            Qual bancada é esta?
          </h1>
          <p className="mt-3 max-w-[54ch] text-[14px] leading-relaxed text-cinza-2">
            A resposta fica gravada neste computador. É ela que decide em qual
            impressora a etiqueta sai — por isso é escolhida uma vez, na
            instalação, e não a cada impressão.
          </p>

          {bancadas.length === 0 ? (
            <div className="mt-8 rounded-[10px] border border-grafite-linha bg-grafite-2 p-5">
              <p className="m-0 text-[14px] font-semibold">
                Nenhuma bancada cadastrada ainda
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-cinza-2">
                As bancadas são criadas em <b>Integração</b>, junto com a
                impressora de cada uma.
              </p>
              <a
                href="/integracao"
                className="mt-4 inline-block rounded-lg bg-champanhe px-4 py-[10px] text-[13px] font-bold text-grafite no-underline"
              >
                Ir para Integração
              </a>
            </div>
          ) : (
            <form action={definirBancada} className="mt-8 flex flex-col gap-2">
              <input type="hidden" name="destino" value={paraOnde} />

              {bancadas.map((b) => (
                <button
                  key={b.id}
                  type="submit"
                  name="estacao"
                  value={b.id}
                  className={`flex items-center gap-4 rounded-[10px] border px-4 py-4 text-left ${
                    b.id === atual
                      ? "border-champanhe bg-grafite-2"
                      : "border-grafite-linha bg-grafite-2 hover:border-grafite-linha-2"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">
                      {b.nome}
                      {b.id === atual && (
                        <span className="ml-2 text-[11.5px] font-semibold text-champanhe">
                          esta máquina
                        </span>
                      )}
                    </span>
                    <span className="mt-[3px] block text-[12px] text-cinza-2">
                      {b.local ?? "sem local"}
                      {" · "}
                      {b.impressora ?? (
                        <span className="text-critico">sem impressora</span>
                      )}
                    </span>
                  </span>
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-cinza-2"
                  >
                    <path d="m10 6 6 6-6 6" />
                  </svg>
                </button>
              ))}
            </form>
          )}
        </div>
      </div>

      <Rodape className="border-t border-grafite-linha px-6 py-[14px]" />
    </main>
  );
}
