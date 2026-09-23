import { cookies } from "next/headers";
import { Rodape } from "@/components/marca";
import { Lateral, type Frente } from "@/components/lateral";
import { criarClienteServidor } from "@/lib/supabase/server";
import { estacaoDaMaquina } from "@/lib/estacao";

export type { Frente };

/**
 * A lateral substitui a antiga barra de cima em vez de somar a ela: dois
 * cromos pela metade custam mais espaço que um inteiro. Ela carrega a marca,
 * as frentes e o usuário, e o topo da tela passa a ser a faixa de abas.
 */
export async function Casca({
  frente,
  email,
  compacta,
  children,
}: {
  frente: Frente;
  email: string;
  /** Telas de bancada abrem com a lateral recolhida: ali largura vale mais. */
  compacta?: boolean;
  children: React.ReactNode;
}) {
  const escolha = (await cookies()).get("zyntra_lateral")?.value;
  const recolhida = escolha
    ? escolha === "recolhida"
    : Boolean(compacta);

  // Qual bancada é esta máquina fica visível o tempo todo. É o dado que decide
  // em qual impressora a etiqueta sai — se estiver errado, o papel aparece na
  // outra ponta do galpão e ninguém entende por quê.
  const estacaoId = await estacaoDaMaquina();
  let bancada: string | null = null;
  let turno: string | null = null;

  if (estacaoId) {
    const supabase = await criarClienteServidor();
    const [{ data: est }, { data: t }] = await Promise.all([
      supabase.from("estacoes").select("nome").eq("id", estacaoId).maybeSingle(),
      supabase
        .from("turnos_abertos")
        .select("operador")
        .eq("estacao_id", estacaoId)
        .maybeSingle(),
    ]);
    bancada = (est as { nome: string } | null)?.nome ?? null;
    turno = (t as { operador: string } | null)?.operador ?? null;
  }

  return (
    <div className="flex min-h-dvh">
      <Lateral
        frente={frente}
        email={email}
        recolhidaInicial={recolhida}
        bancada={bancada}
        turno={turno}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-fundo">
        <main className="flex flex-1 flex-col">{children}</main>
        <Rodape className="shrink-0 border-t border-grafite-linha bg-grafite px-5 py-[10px]" />
      </div>
    </div>
  );
}

export function Abas({
  itens,
  ativa,
}: {
  itens: { rotulo: string; contagem?: string; tom?: "critico" | "atencao" }[];
  ativa: string;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-[30px] border-b border-linha bg-superficie px-5">
      {itens.map((i) => {
        const atual = i.rotulo === ativa;
        return (
          <span
            key={i.rotulo}
            className={`flex flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] ${
              atual ? "border-tinta text-tinta" : "border-transparent text-suave"
            }`}
          >
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
              {i.rotulo}
            </span>
            <span
              className={`text-[25px] font-bold leading-none tracking-[-0.02em] ${
                i.tom === "critico"
                  ? "text-critico"
                  : i.tom === "atencao"
                    ? "text-atencao"
                    : atual
                      ? "text-tinta"
                      : "text-[#43464D]"
              }`}
            >
              {i.contagem ?? "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}
