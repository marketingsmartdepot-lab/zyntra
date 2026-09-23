import { redirect } from "next/navigation";
import Link from "next/link";
import { Logotipo, Rodape, SimboloZ } from "@/components/marca";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";
import { abrirTurno, encerrarTurno } from "./acoes";
import { Teclado } from "./teclado";

export const metadata = { title: "Turno — ZYNTRA" };

type Operador = { id: string; nome: string; papel: string; bloqueado: boolean };
type Turno = { operador: string; iniciada_em: string; estacao: string };

export default async function PaginaTurno({
  searchParams,
}: {
  searchParams: Promise<{ falha?: string; destino?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/turno");

  const estacao = await estacaoDaMaquina();
  if (!estacao) redirect("/bancada?destino=/turno");

  const { falha, destino } = await searchParams;
  const paraOnde =
    destino && destino.startsWith("/") && !destino.startsWith("//")
      ? destino
      : "/expedicao";

  const [{ data: turnos }, { data: ops }, { data: bancada }] = await Promise.all([
    supabase
      .from("turnos_abertos")
      .select("operador, iniciada_em, estacao")
      .eq("estacao_id", estacao)
      .maybeSingle(),
    supabase
      .from("operadores_situacao")
      .select("id, nome, papel, bloqueado")
      .eq("ativo", true)
      .eq("tem_pin", true)
      .order("nome"),
    supabase.from("estacoes").select("nome").eq("id", estacao).maybeSingle(),
  ]);

  const turno = turnos as Turno | null;
  const operadores = (ops ?? []) as Operador[];
  const nomeBancada = (bancada as { nome: string } | null)?.nome ?? "esta bancada";

  return (
    <main className="flex min-h-dvh flex-col bg-grafite text-offwhite">
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 flex items-center gap-3">
            <SimboloZ className="block h-[30px] w-[30px]" />
            <Logotipo className="block h-[15px] w-auto text-offwhite" />
            <span className="flex-1" />
            <Link
              href="/bancada"
              className="text-[11.5px] font-semibold text-cinza-2 no-underline"
            >
              {nomeBancada}
            </Link>
          </div>

          {turno ? (
            <div className="rounded-2xl border border-grafite-linha bg-grafite-2 p-6">
              <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2">
                Em turno nesta bancada
              </p>
              <p className="m-0 mt-2 text-[24px] font-bold tracking-[-0.02em]">
                {turno.operador}
              </p>
              <p className="m-0 mt-1 text-[12.5px] text-cinza-2">
                desde{" "}
                {new Date(turno.iniciada_em).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                })}
              </p>

              <div className="mt-6 flex gap-2">
                <Link
                  href={paraOnde}
                  className="flex-1 rounded-[10px] bg-champanhe py-[13px] text-center text-[14px] font-bold text-grafite no-underline"
                >
                  Continuar
                </Link>
                <form action={encerrarTurno} className="flex-1">
                  <button
                    type="submit"
                    className="w-full rounded-[10px] border border-grafite-linha py-[13px] text-[14px] font-semibold text-cinza-2"
                  >
                    Encerrar turno
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-grafite-linha bg-grafite-2 p-6">
              <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">
                Quem está nesta bancada?
              </h1>
              <p className="mb-5 mt-2 text-[12.5px] leading-relaxed text-cinza-2">
                O PIN diz quem é a pessoa. É o que faz cada bipe e cada
                liberação ter dono.
              </p>

              {falha && falha !== "encerrado" && (
                <p
                  role="alert"
                  className="mb-4 rounded-lg border border-critico-linha/40 bg-critico/15 px-3 py-2 text-[12.5px] font-semibold text-[#F0B8B0]"
                >
                  {mensagem(falha)}
                </p>
              )}

              {falha === "encerrado" && (
                <p className="mb-4 rounded-lg border border-grafite-linha bg-grafite-3 px-3 py-2 text-[12.5px] text-cinza-2">
                  Turno encerrado.
                </p>
              )}

              {operadores.length === 0 ? (
                <p className="m-0 rounded-lg border border-grafite-linha bg-grafite-3 px-4 py-4 text-[12.5px] leading-relaxed text-cinza-2">
                  Nenhum operador ativo com PIN. Cadastre em{" "}
                  <Link href="/integracao?aba=operadores" className="text-champanhe">
                    Integração → Operadores
                  </Link>
                  .
                </p>
              ) : (
                <Teclado
                  operadores={operadores}
                  destino={paraOnde}
                  acao={abrirTurno}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <Rodape className="border-t border-grafite-linha px-6 py-[14px]" />
    </main>
  );
}

function mensagem(falha: string) {
  const texto: Record<string, string> = {
    pin_incorreto: "PIN incorreto.",
    bloqueado:
      "Cinco erros seguidos. Esta pessoa fica bloqueada por dez minutos — um líder pode destravar em Integração.",
    operador_invalido: "Este operador não está mais ativo.",
    sem_operador: "Escolha quem está na bancada.",
  };
  return texto[falha] ?? "Não foi possível abrir o turno.";
}
