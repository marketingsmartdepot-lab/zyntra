import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { Barra, Indicador } from "@/components/barra";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Contas } from "./contas";
import { AplicacaoMl } from "./ml-aplicacao";
import { Impressoras } from "./impressoras";
import { Estoque } from "./estoque";
import { Cadastros } from "./cadastros";
import { Equipe } from "./equipe";

export const metadata = { title: "Integração — ZYNTRA" };

const ABAS = [
  { chave: "contas", rotulo: "Conexão das contas" },
  { chave: "impressoras", rotulo: "Estações e impressoras" },
  { chave: "estoque", rotulo: "Estoque" },
  { chave: "cadastros", rotulo: "Cadastros" },
  { chave: "equipe", rotulo: "Pessoas" },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

export default async function PaginaIntegracao({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string;
    falha?: string;
    bling?: string;
    ml?: string;
    sincronia?: string;
    busca?: string;
    pagina?: string;
    filtro?: string;
    lidos?: string;
    criados?: string;
    casados?: string;
    sem_codigo?: string;
    repetidos?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/integracao");

  const {
    aba: pedida, falha, bling, ml, sincronia,
    busca, pagina, filtro,
    lidos, criados, casados, sem_codigo, repetidos,
  } = await searchParams;

  // O endereço público de retorno do OAuth sai daqui, não de uma constante:
  // em produção e na máquina local ele é diferente, e cravar um dos dois
  // faria a tela ensinar o endereço errado na outra.
  const cabecalhos = await headers();
  const anfitriao = cabecalhos.get("host") ?? "localhost:3000";
  const origem = `${anfitriao.startsWith("localhost") ? "http" : "https"}://${anfitriao}`;
  const aba: Aba = ABAS.some((a) => a.chave === pedida)
    ? (pedida as Aba)
    : "contas";

  const [{ count: contas }, { count: impressoras }] = await Promise.all([
    supabase.from("contas").select("id", { count: "exact", head: true }),
    supabase.from("impressoras").select("id", { count: "exact", head: true }),
  ]);

  // A fila de baixas na aba: se encher, alguma coisa não está saindo.
  const { count: baixasNaFila } = await supabase
    .from("baixas_estoque")
    .select("id", { count: "exact", head: true })
    .neq("situacao", "enviada");

  // A saúde das conexões fica visível em toda aba: conexão caída para a
  // operação inteira, e antes só se descobria entrando na aba certa.
  const { data: saude } = await supabase
    .from("saude_das_conexoes")
    .select("conectada, expirada")
    .eq("alvo", "mercado_livre");

  const linhas = (saude ?? []) as { conectada: boolean; expirada: boolean }[];
  const conectadas = linhas.filter((l) => l.conectada).length;
  const expiradas = linhas.filter((l) => l.expirada).length;

  // Toda pessoa do galpão, com login ou com PIN. Contar só quem tem e-mail
  // deixava de fora justamente quem trabalha na bancada.
  const { count: pessoas } = await supabase
    .from("pessoas")
    .select("pessoa_id", { count: "exact", head: true });

  const { count: empresas } = await supabase
    .from("empresas")
    .select("id", { count: "exact", head: true })
    .eq("ativa", true);

  return (
    <Casca frente="integracao" email={user.email ?? "sem e-mail"}>
      <Barra
        rotulo="Seções da integração"
        abas={[
          {
            chave: "contas",
            href: "/integracao?aba=contas",
            rotulo: "Conexão das contas",
            contagem: contas ?? 0,
            ativa: aba === "contas",
          },
          {
            chave: "impressoras",
            href: "/integracao?aba=impressoras",
            rotulo: "Estações e impressoras",
            contagem: impressoras ?? 0,
            ativa: aba === "impressoras",
          },
          {
            chave: "estoque",
            href: "/integracao?aba=estoque",
            rotulo: "Estoque",
            contagem: baixasNaFila ?? 0,
            ativa: aba === "estoque",
            // Baixa parada na fila é problema, não volume de trabalho.
            tom: "atencao" as const,
          },
          {
            chave: "cadastros",
            href: "/integracao?aba=cadastros",
            rotulo: "Cadastros",
            // Cadastro não é fila: contar empresas não diz nada a ninguém.
            ativa: aba === "cadastros",
            separadaAntes: true,
          },
          {
            chave: "equipe",
            href: "/integracao?aba=equipe",
            rotulo: "Pessoas",
            contagem: pessoas ?? 0,
            ativa: aba === "equipe",
          },
        ]}
        direita={
          conectadas === 0 ? (
            <Indicador valor="Nenhuma conta conectada" tom="critico" />
          ) : expiradas > 0 ? (
            <Indicador
              valor={`${expiradas} ${expiradas === 1 ? "conexão expirada" : "conexões expiradas"}`}
              tom="critico"
            />
          ) : (
            <Indicador
              valor={`${conectadas} ${conectadas === 1 ? "conta conectada" : "contas conectadas"}`}
              tom="ok"
            />
          )
        }
        explicacao={
          <>
            {aba === "contas" &&
              "Quem fatura e de quem é o estoque são coisas separadas. Aqui isso fica explícito."}
            {aba === "impressoras" &&
              "A impressora é alcançada por um agente na máquina da bancada. Navegador não fala com USB."}
            {aba === "estoque" &&
              "A baixa acontece quando a NF-e é autorizada, não quando a caixa sai — senão a peça segue vendável por horas."}
            {aba === "cadastros" &&
              "O que o sistema lê e ninguém tinha onde criar. Muda raramente, então fica tudo junto."}
            {aba === "equipe" &&
              "Toda pessoa do ZYNTRA, com login ou com PIN de bancada. É aqui que se escolhe o que cada uma enxerga e faz."}
          </>
        }
      />

      <div className="flex flex-1 flex-col bg-superficie">
        {aba === "contas" && (
          <>
            <AplicacaoMl origem={origem} />
            <Contas falha={falha} ml={ml} />
          </>
        )}
        {aba === "impressoras" && <Impressoras />}
        {aba === "estoque" && (
          <Estoque falha={falha} bling={bling} origem={origem} />
        )}
        {aba === "cadastros" && <Cadastros falha={falha} />}
        {aba === "equipe" && <Equipe falha={falha} />}
      </div>
    </Casca>
  );
}

