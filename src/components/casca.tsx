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
  // A porta. Perfil inativo passa pelo login — a senha está certa — mas não é
  // da equipe. Sem isto ele veria o ZYNTRA inteiro com todas as listas vazias
  // e acharia que o sistema quebrou, quando na verdade nunca foi liberado.
  const supabaseGuarda = await criarClienteServidor();
  const { data: daEquipe } = await supabaseGuarda.rpc("e_da_equipe");
  if (daEquipe === false) return <SemAcesso email={email} />;

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


/**
 * A tela de quem tem login mas não foi autorizado.
 *
 * Diz o que aconteceu e o que fazer, sem insinuar erro de senha — a senha
 * está certa. E não mostra nada do sistema: nem contagem, nem nome de conta,
 * nem a lateral com as frentes.
 */
function SemAcesso({ email }: { email: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-[54ch] text-center">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">
            Esta conta ainda não foi liberada
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-suave">
            Seu login funcionou, mas <b className="font-semibold text-tinta">{email}</b>{" "}
            não está na lista de pessoas autorizadas a usar o ZYNTRA. Peça a um
            administrador para liberar seu e-mail em Integração › Equipe.
          </p>
          <form action="/auth/sair" method="post" className="mt-7">
            <button
              type="submit"
              className="rounded-lg border border-linha bg-superficie px-4 py-[9px] text-[13px] font-semibold"
            >
              Sair
            </button>
          </form>
        </div>
      </main>
      <Rodape className="shrink-0 border-t border-grafite-linha bg-grafite px-5 py-[10px]" />
    </div>
  );
}
