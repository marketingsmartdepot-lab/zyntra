import { redirect } from "next/navigation";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Doca } from "./doca";
import { EstacaoDeSaida } from "./saida";
import { Fechamento } from "./fechamento";

export const metadata = { title: "Logística — ZYNTRA" };

const ABAS = [
  { chave: "doca", rotulo: "Doca" },
  { chave: "saida", rotulo: "Estação de saída" },
  { chave: "fechamento", rotulo: "Fechamento" },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

export default async function PaginaLogistica({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/logistica");

  const { aba: pedida } = await searchParams;
  const aba: Aba = ABAS.some((a) => a.chave === pedida)
    ? (pedida as Aba)
    : "doca";

  const [{ data: destinos }, { data: saidas }] = await Promise.all([
    supabase.from("doca_por_destino").select("*").order("modalidade"),
    supabase
      .from("saidas_resumo")
      .select("*")
      .order("aberta_em", { ascending: false })
      .limit(50),
  ]);

  const naDoca = (destinos ?? []).reduce(
    (t: number, d: { pacotes: number }) => t + d.pacotes,
    0,
  );
  const abertas = (saidas ?? []).filter(
    (s: { situacao: string }) => s.situacao === "em_andamento",
  );

  return (
    <Casca frente="logistica" email={user.email ?? "sem e-mail"}>
      <nav
        aria-label="Seções da logística"
        className="flex shrink-0 items-stretch gap-[30px] border-b border-linha bg-superficie px-5"
      >
        <AbaLink
          chave="doca"
          rotulo="Doca"
          contagem={String(naDoca)}
          ativa={aba === "doca"}
        />
        <AbaLink
          chave="saida"
          rotulo="Estação de saída"
          contagem={String(abertas.length)}
          ativa={aba === "saida"}
        />
        <span className="my-[15px] w-px shrink-0 bg-linha" />
        <AbaLink
          chave="fechamento"
          rotulo="Fechamento"
          contagem={mesAtual()}
          pequena
          ativa={aba === "fechamento"}
        />
        <span className="flex-1" />
      </nav>

      <p className="shrink-0 border-b border-linha bg-fundo px-5 py-[11px] text-[12.5px] text-suave">
        {aba === "doca" &&
          "Tudo aqui já foi conferido e lacrado na Expedição. A doca não abre caixa — ela registra quem levou para fora."}
        {aba === "saida" &&
          "A segunda bipagem: contra a relação que sai pela porta, não contra o que o cliente comprou."}
        {aba === "fechamento" &&
          "Soma dos valores congelados no instante do bipe. Só o Flex tem custo."}
      </p>

      <div className="flex-1 bg-superficie">
        {aba === "doca" && <Doca destinos={destinos ?? []} />}
        {aba === "saida" && <EstacaoDeSaida saidas={saidas ?? []} />}
        {aba === "fechamento" && <Fechamento />}
      </div>
    </Casca>
  );
}

function mesAtual() {
  const m = new Date().toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function AbaLink({
  chave,
  rotulo,
  contagem,
  ativa,
  pequena,
}: {
  chave: Aba;
  rotulo: string;
  contagem: string;
  ativa: boolean;
  pequena?: boolean;
}) {
  return (
    <Link
      href={`/logistica?aba=${chave}`}
      aria-current={ativa ? "page" : undefined}
      className={`flex shrink-0 flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] no-underline ${
        ativa ? "border-tinta text-tinta" : "border-transparent text-suave"
      }`}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
        {rotulo}
      </span>
      <span
        className={`font-bold leading-none tracking-[-0.02em] tabular-nums ${
          pequena ? "text-[17px]" : "text-[25px]"
        } ${ativa ? "text-tinta" : "text-[#43464D]"}`}
      >
        {contagem}
      </span>
    </Link>
  );
}
