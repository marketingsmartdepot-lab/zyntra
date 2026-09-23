import { redirect } from "next/navigation";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Contas } from "./contas";
import { Impressoras } from "./impressoras";
import { Operadores } from "./operadores";
import { Estoque } from "./estoque";

export const metadata = { title: "Integração — ZYNTRA" };

const ABAS = [
  { chave: "contas", rotulo: "Conexão das contas" },
  { chave: "impressoras", rotulo: "Estações e impressoras" },
  { chave: "operadores", rotulo: "Operadores" },
  { chave: "estoque", rotulo: "Estoque" },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

export default async function PaginaIntegracao({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; falha?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/integracao");

  const { aba: pedida, falha } = await searchParams;
  const aba: Aba = ABAS.some((a) => a.chave === pedida)
    ? (pedida as Aba)
    : "contas";

  const [{ count: contas }, { count: impressoras }, { count: operadores }] =
    await Promise.all([
      supabase.from("contas").select("id", { count: "exact", head: true }),
      supabase.from("impressoras").select("id", { count: "exact", head: true }),
      supabase
        .from("operadores")
        .select("id", { count: "exact", head: true })
        .eq("ativo", true),
    ]);

  // A fila de baixas na aba: se encher, alguma coisa não está saindo.
  const { count: baixasNaFila } = await supabase
    .from("baixas_estoque")
    .select("id", { count: "exact", head: true })
    .neq("situacao", "enviada");

  return (
    <Casca frente="integracao" email={user.email ?? "sem e-mail"}>
      <nav
        aria-label="Seções da integração"
        className="flex shrink-0 items-stretch gap-[30px] border-b border-linha bg-superficie px-5"
      >
        <AbaLink
          chave="contas"
          rotulo="Conexão das contas"
          contagem={contas ?? 0}
          ativa={aba === "contas"}
        />
        <AbaLink
          chave="impressoras"
          rotulo="Estações e impressoras"
          contagem={impressoras ?? 0}
          ativa={aba === "impressoras"}
        />
        <AbaLink
          chave="operadores"
          rotulo="Operadores"
          contagem={operadores ?? 0}
          ativa={aba === "operadores"}
        />
        <AbaLink
          chave="estoque"
          rotulo="Estoque"
          contagem={baixasNaFila ?? 0}
          ativa={aba === "estoque"}
        />
        <span className="flex-1" />
      </nav>

      <p className="shrink-0 border-b border-linha bg-fundo px-5 py-[11px] text-[12.5px] text-suave">
        {aba === "contas" &&
          "Quem fatura e de quem é o estoque são coisas separadas. Aqui isso fica explícito."}
        {aba === "impressoras" &&
          "A impressora é alcançada por um agente na máquina da bancada. Navegador não fala com USB."}
        {aba === "operadores" &&
          "Quem trabalha na bancada não usa e-mail e senha: entra com nome e PIN. São coisas separadas de propósito."}
        {aba === "estoque" &&
          "A baixa acontece quando a NF-e é autorizada, não quando a caixa sai — senão a peça segue vendável por horas."}
      </p>

      <div className="flex flex-1 flex-col bg-superficie">
        {aba === "contas" && <Contas falha={falha} />}
        {aba === "impressoras" && <Impressoras />}
        {aba === "operadores" && <Operadores falha={falha} />}
        {aba === "estoque" && <Estoque falha={falha} />}
      </div>
    </Casca>
  );
}

function AbaLink({
  chave,
  rotulo,
  contagem,
  ativa,
}: {
  chave: Aba;
  rotulo: string;
  contagem: number;
  ativa: boolean;
}) {
  return (
    <Link
      href={`/integracao?aba=${chave}`}
      aria-current={ativa ? "page" : undefined}
      className={`flex shrink-0 flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] no-underline ${
        ativa ? "border-tinta text-tinta" : "border-transparent text-suave"
      }`}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
        {rotulo}
      </span>
      <span
        className={`text-[25px] font-bold leading-none tracking-[-0.02em] tabular-nums ${
          ativa ? "text-tinta" : "text-[#43464D]"
        }`}
      >
        {contagem}
      </span>
    </Link>
  );
}
