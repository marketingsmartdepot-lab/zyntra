import { redirect } from "next/navigation";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { Barra, Indicador } from "@/components/barra";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Doca, type EntregaResumo } from "./doca";
import { EstacaoDeSaida, type SaidaResumo } from "./saida";
import { Fechamento } from "./fechamento";
import { BancadaDeSaida } from "./bancada";
import { turnoDaMaquina } from "@/lib/estacao";
import { BancadaDoca } from "./bancada-doca";

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
  searchParams: Promise<{
    aba?: string;
    saida?: string;
    entrega?: string;
    bipar?: string;
    falha?: string;
    fechada?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/logistica");

  const {
    aba: pedida,
    saida: saidaId,
    entrega: entregaId,
    bipar,
    falha,
    fechada,
  } = await searchParams;
  const aba: Aba = ABAS.some((a) => a.chave === pedida)
    ? (pedida as Aba)
    : "doca";

  const [{ data: destinos }, { data: saidas }, { data: entregas }] =
    await Promise.all([
      supabase.from("doca_por_destino").select("*").order("modalidade"),
      supabase
        .from("saidas_resumo")
        .select("*")
        .order("aberta_em", { ascending: false })
        .limit(50),
      supabase
        .from("entregas_doca_resumo")
        .select("*")
        .order("entregue_em", { ascending: false })
        .limit(20),
    ]);

  const naDoca = (destinos ?? []).reduce(
    (t: number, d: { pacotes: number }) => t + d.pacotes,
    0,
  );
  const abertas = (saidas ?? []).filter(
    (s: { situacao: string }) => s.situacao === "em_andamento",
  );

  // A bancada só abre para uma saída que ainda aceita bipe. Uma já fechada
  // volta para a lista em vez de mostrar um leitor que não registra nada.
  const turno = await turnoDaMaquina();

  // O acumulado do mês fica visível em toda aba da Logística: é o número que
  // vira dinheiro no fim do mês, e antes só aparecia se alguém clicasse em
  // Fechamento.
  const primeiroDia = new Date();
  primeiroDia.setDate(1);
  const { data: doMes } = await supabase
    .from("fechamento_custo_etiqueta")
    .select("total")
    .gte("dia", primeiroDia.toISOString().slice(0, 10));

  const acumulado = ((doMes ?? []) as { total: number | string }[]).reduce(
    (t, l) => t + Number(l.total),
    0,
  );

  const noCarrinho =
    bipar === "1" && entregaId
      ? ((entregas ?? []) as EntregaResumo[]).find((e) => e.id === entregaId)
      : null;

  const naBancada =
    bipar === "1" && saidaId
      ? ((abertas as SaidaResumo[]).find((s) => s.id === saidaId) ?? null)
      : null;

  return (
    <Casca frente="logistica" email={user.email ?? "sem e-mail"}>
      <Barra
        rotulo="Seções da logística"
        abas={[
          {
            chave: "doca",
            href: "/logistica?aba=doca",
            rotulo: "Doca",
            contagem: naDoca,
            ativa: aba === "doca",
          },
          {
            chave: "saida",
            href: "/logistica?aba=saida",
            rotulo: "Estação de saída",
            contagem: abertas.length,
            ativa: aba === "saida",
          },
          {
            chave: "fechamento",
            href: "/logistica?aba=fechamento",
            rotulo: "Fechamento",
            // Fechamento não conta pacote: conta mês.
            legenda: mesAtual().toLowerCase(),
            ativa: aba === "fechamento",
            separadaAntes: true,
          },
        ]}
        direita={
          <Indicador
            rotulo={`Flex em ${mesAtual().toLowerCase()}`}
            valor={acumulado.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          />
        }
        explicacao={
          <>
            {aba === "doca" &&
              "Tudo aqui já foi conferido e lacrado na Expedição. A doca não abre caixa — ela registra quem levou para fora."}
            {aba === "saida" &&
              "A segunda bipagem: contra a relação que sai pela porta, não contra o que o cliente comprou."}
            {aba === "fechamento" &&
              "Soma dos valores congelados no instante do bipe. Só o Flex tem custo."}
          </>
        }
      />

      {falha && (
        <p className="shrink-0 border-b border-critico-linha bg-critico-bg px-5 py-[10px] text-[12.5px] font-semibold text-critico">
          {falha === "saida_vazia"
            ? "Nada foi bipado nesta saída, então não há o que fechar."
            : falha === "saida_nao_aberta"
              ? "Esta saída já estava fechada."
              : falha === "modalidade_nao_encontrada"
                ? "Este destino não existe mais."
                : falha === "sem_nome"
                  ? "Escreva o nome de quem está levando o carrinho."
                  : "Não foi possível concluir a operação."}
        </p>
      )}

      {fechada && (
        <p className="shrink-0 border-b border-ok-linha bg-ok-bg px-5 py-[10px] text-[12.5px] font-semibold text-ok">
          Saída fechada. O valor acumulado entra no fechamento do mês.
        </p>
      )}

      <div className="flex-1 bg-superficie">
        {aba === "doca" &&
          (noCarrinho ? (
            <BancadaDoca
              entregaId={noCarrinho.id}
              codigo={noCarrinho.codigo}
              entreguePor={noCarrinho.entregue_por}
              jaBipados={noCarrinho.pacotes}
            />
          ) : (
            <Doca
              destinos={destinos ?? []}
              entregas={(entregas ?? []) as EntregaResumo[]}
            />
          ))}
        {aba === "saida" &&
          (naBancada ? (
            <BancadaDeSaida
              saidaId={naBancada.id}
              codigo={naBancada.codigo}
              modalidade={naBancada.modalidade}
              jaBipados={naBancada.pacotes}
              totalInicial={Number(naBancada.total)}
              aindaNaDoca={naBancada.na_doca}
              operadorId={turno?.operadorId ?? null}
            />
          ) : (
            <EstacaoDeSaida saidas={saidas ?? []} />
          ))}
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

