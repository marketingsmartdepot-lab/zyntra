import Link from "next/link";
import { cookies } from "next/headers";
import { Rodape } from "@/components/marca";
import { permissoesDeAgora, FRENTE_PERMISSAO, FRENTES } from "@/lib/permissoes";
import { Lateral } from "@/components/lateral";
import type { Frente } from "@/lib/frentes";
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

  if (estacaoId) {
    const supabase = await criarClienteServidor();
    const { data: est } = await supabase
      .from("estacoes")
      .select("nome")
      .eq("id", estacaoId)
      .maybeSingle();
    bancada = (est as { nome: string } | null)?.nome ?? null;
  }

  // A lateral só mostra o que a pessoa pode abrir. Esconder não é a trava — a
  // trava está aqui embaixo e no banco — mas menu que oferece porta trancada
  // faz a pessoa achar que o sistema quebrou.
  const pode = await permissoesDeAgora();
  const abertas = FRENTES.filter((f) => pode.has(f.permissao));
  const frentesVisiveis = abertas.map((f) => f.chave);

  // A trava de verdade. Esconder da lateral não impede ninguém de digitar
  // /catalogo na barra de endereço, e toda frente abre por uma URL só. Sem
  // isto, "o que cada pessoa pode ver" era sugestão de menu.
  if (!pode.has(FRENTE_PERMISSAO[frente])) {
    return <PortaTrancada frente={frente} abertas={abertas} email={email} />;
  }

  return (
    <div className="flex min-h-dvh">
      <Lateral
        frente={frente}
        email={email}
        recolhidaInicial={recolhida}
        bancada={bancada}
        frentesVisiveis={frentesVisiveis}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-fundo">
        <main className="flex flex-1 flex-col">{children}</main>
        <Rodape className="shrink-0 border-t border-grafite-linha bg-grafite px-5 py-[10px]" />
      </div>
    </div>
  );
}


/**
 * A tela de quem é da equipe mas não desta frente.
 *
 * Não é a mesma coisa que não ter acesso ao ZYNTRA, e por isso não é a mesma
 * tela: aqui a pessoa trabalha no sistema, só não nesta parte. Então diz qual
 * parte é, e oferece as portas que ela abre — quem cai aqui por um link antigo
 * ou um favorito precisa de um caminho de volta, não de um beco.
 */
function PortaTrancada({
  frente,
  abertas,
  email,
}: {
  frente: Frente;
  abertas: { chave: Frente; rotulo: string; href: string }[];
  email: string;
}) {
  const nome = FRENTES.find((f) => f.chave === frente)?.rotulo ?? frente;

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-[54ch] text-center">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">
            {nome} não está liberada para você
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-suave">
            <b className="font-semibold text-tinta">{email}</b> usa o ZYNTRA, mas
            não tem permissão de enxergar {nome}. Quem muda isso é um
            administrador, em Integração › Equipe.
          </p>

          {abertas.length > 0 ? (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              {abertas.map((f) => (
                <Link
                  key={f.chave}
                  href={f.href}
                  className="rounded-lg border border-linha bg-superficie px-4 py-[9px] text-[13px] font-semibold"
                >
                  {f.rotulo}
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-[14px] text-suave">
              Nenhuma frente está liberada para esta conta ainda.
            </p>
          )}

          <form action="/auth/sair" method="post" className="mt-4">
            <button
              type="submit"
              className="text-[13px] font-semibold text-suave underline underline-offset-2"
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
