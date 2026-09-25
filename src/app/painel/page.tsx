import Link from "next/link";
import { redirect } from "next/navigation";
import { Casca } from "@/components/casca";
import { Barra } from "@/components/barra";
import { criarClienteServidor } from "@/lib/supabase/server";
import { GraficoDeVendas, moeda, type DiaDeVenda } from "./grafico";

export const metadata = { title: "Painel — ZYNTRA" };

const PERIODOS = [7, 30, 90];

const ETAPAS = [
  { etapa: "aberto", rotulo: "Aberto", cor: "bg-critico" },
  { etapa: "faturado", rotulo: "Faturado", cor: "bg-atencao" },
  { etapa: "separar", rotulo: "Separar", cor: "bg-tinta" },
  { etapa: "conferir", rotulo: "Conferir", cor: "bg-tinta" },
  { etapa: "pronto", rotulo: "Pronto pra envio", cor: "bg-ok" },
];

type Resumo = {
  faturamento: number | string;
  pedidos: number;
  unidades: number;
  ticket: number | string;
  faturamento_antes: number | string;
  pedidos_antes: number;
  ticket_antes: number | string;
};

type Produto = {
  chave: string;
  titulo: string;
  codigo: string | null;
  foto_url: string | null;
  unidades: number;
  receita: number | string;
  mapeado: boolean;
};

type Volume = { etapa: string; pacotes: number };
type Prazos = { atrasados: number; vencendo_em_2h: number; vencendo_hoje: number };
type Bancada = { divergencias_abertas: number; agentes_offline: number };

export default async function PaginaPainel({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/painel");

  const { dias: pedido } = await searchParams;
  const dias = PERIODOS.includes(Number(pedido)) ? Number(pedido) : 30;

  const [
    { data: resumoBruto },
    { data: porDia },
    { data: produtos },
    { data: volumes },
    { data: prazos },
    { data: bancada },
  ] = await Promise.all([
    supabase.rpc("painel_resumo", { p_dias: dias }),
    supabase.rpc("painel_vendas_por_dia", { p_dias: dias }),
    supabase.rpc("painel_produtos", { p_dias: dias, p_limite: 6 }),
    supabase.from("painel_volumes").select("*"),
    supabase.from("painel_prazos").select("*").maybeSingle(),
    supabase.from("painel_bancada").select("*").maybeSingle(),
  ]);

  const r = (Array.isArray(resumoBruto) ? resumoBruto[0] : resumoBruto) as
    | Resumo
    | null;
  const grafico = (porDia ?? []) as DiaDeVenda[];
  const mais = (produtos ?? []) as Produto[];
  const p = prazos as Prazos | null;
  const b = bancada as Bancada | null;

  const porEtapa = new Map<string, number>();
  for (const v of (volumes ?? []) as Volume[]) porEtapa.set(v.etapa, v.pacotes);
  const maiorEtapa = Math.max(1, ...ETAPAS.map((e) => porEtapa.get(e.etapa) ?? 0));

  // A faixa de alerta só existe quando há o que resolver. Sem nada parado,
  // ela some — barra de alerta permanente é barra que ninguém mais lê.
  const alertas: string[] = [];
  const parados = porEtapa.get("aberto") ?? 0;
  if (parados > 0) {
    alertas.push(`${parados} ${parados === 1 ? "pedido parado" : "pedidos parados"} em Aberto`);
  }
  if ((b?.divergencias_abertas ?? 0) > 0) {
    alertas.push(
      `${b?.divergencias_abertas} ${b?.divergencias_abertas === 1 ? "divergência esperando" : "divergências esperando"} líder`,
    );
  }
  if ((b?.agentes_offline ?? 0) > 0) {
    alertas.push(
      `${b?.agentes_offline} ${b?.agentes_offline === 1 ? "agente de impressão offline" : "agentes de impressão offline"}`,
    );
  }
  if ((p?.atrasados ?? 0) > 0) {
    alertas.push(`${p?.atrasados} ${p?.atrasados === 1 ? "atrasado" : "atrasados"}`);
  }

  const maiorProduto = Math.max(1, ...mais.map((m) => m.unidades));

  return (
    <Casca frente="painel" email={user.email ?? "sem e-mail"}>
      <Barra
        rotulo="Período do painel"
        abas={PERIODOS.map((d) => ({
          chave: String(d),
          href: `/painel?dias=${d}`,
          rotulo: `${d} dias`,
          ativa: d === dias,
        }))}
        direita={
          <Link
            href="/expedicao"
            className="rounded-[9px] border border-linha px-3 py-[6px] text-[12.5px] font-semibold text-tinta no-underline"
          >
            Ir para a esteira
          </Link>
        }
        explicacao="Tudo calculado na hora. Nenhum número fica guardado em coluna — contador desatualiza e passa a mentir."
      />

      <div className="flex flex-col gap-[14px] bg-fundo p-5">
        {alertas.length > 0 && (
          <p className="m-0 flex flex-wrap items-center gap-[10px] rounded-[10px] border border-critico-linha bg-critico-bg px-[14px] py-[10px] text-[12.5px] font-semibold text-critico">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            {alertas.map((a, i) => (
              <span key={a} className="flex items-center gap-[10px]">
                {i > 0 && (
                  <span aria-hidden="true" className="text-critico-linha">
                    ·
                  </span>
                )}
                {a}
              </span>
            ))}
            <Link
              href="/expedicao?etapa=aberto"
              className="ml-auto font-semibold text-critico underline underline-offset-[3px]"
            >
              Resolver
            </Link>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero
            rotulo="Faturamento"
            valor={moeda(r?.faturamento ?? 0)}
            antes={Number(r?.faturamento ?? 0)}
            base={Number(r?.faturamento_antes ?? 0)}
            dias={dias}
          />
          <Numero
            rotulo="Pedidos"
            valor={String(r?.pedidos ?? 0)}
            antes={r?.pedidos ?? 0}
            base={r?.pedidos_antes ?? 0}
            dias={dias}
          />
          <Numero
            rotulo="Ticket médio"
            valor={moeda(r?.ticket ?? 0)}
            antes={Number(r?.ticket ?? 0)}
            base={Number(r?.ticket_antes ?? 0)}
            dias={dias}
          />
          <div className="rounded-[10px] border border-linha bg-superficie px-4 py-[14px]">
            <Rotulo>Unidades</Rotulo>
            <div className="mt-[6px] font-mono text-[26px] font-semibold tracking-[-0.03em] tabular-nums">
              {r?.unidades ?? 0}
            </div>
            <div className="mt-1 text-[11.5px] text-suave">
              {(r?.pedidos ?? 0) > 0
                ? `${((r?.unidades ?? 0) / (r?.pedidos ?? 1)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} por pedido`
                : "nenhum pedido no período"}
            </div>
          </div>
        </div>

        <section className="rounded-[10px] border border-linha bg-superficie px-5 py-4">
          <div className="mb-[14px] flex flex-wrap items-baseline gap-3">
            <h2 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
              Vendas por dia
            </h2>
            <span className="text-[12px] text-suave">
              pelo pagamento, sem os cancelados
            </span>
            <MelhorDia dias={grafico} />
          </div>
          <GraficoDeVendas dias={grafico} />
        </section>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-[10px] border border-linha bg-superficie px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
                Produtos mais vendidos
              </h2>
              <span className="text-[12px] text-suave">
                por unidade, no período
              </span>
            </div>

            {mais.length === 0 ? (
              <p className="m-0 py-6 text-[13px] text-suave">
                Nenhum item vendido no período.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {mais.map((m) => (
                  <li
                    key={m.chave}
                    className="flex items-center gap-3 border-b border-linha-suave py-[9px] last:border-b-0"
                  >
                    <Foto url={m.foto_url} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {m.titulo}
                      </span>
                      {!m.mapeado ? (
                        <span className="mt-[2px] block text-[11px] font-semibold text-critico">
                          anúncio sem SKU
                        </span>
                      ) : null}
                      <span className="mt-1 block h-1 rounded-full bg-fundo">
                        <span
                          className="block h-1 rounded-full bg-tinta"
                          style={{
                            width: `${Math.round((m.unidades / maiorProduto) * 100)}%`,
                          }}
                        />
                      </span>
                    </span>
                    <span className="w-[54px] text-right font-mono text-[14px] font-semibold tabular-nums">
                      {m.unidades}
                    </span>
                    <span className="hidden w-[86px] text-right font-mono text-[12.5px] tabular-nums text-suave sm:block">
                      {moeda(m.receita)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[10px] border border-linha bg-superficie px-5 py-4">
            <h2 className="m-0 mb-3 text-[14px] font-bold tracking-[-0.01em]">
              A esteira agora
            </h2>

            {ETAPAS.map((e) => {
              const n = porEtapa.get(e.etapa) ?? 0;
              return (
                <Link
                  key={e.etapa}
                  href={`/expedicao?etapa=${e.etapa}`}
                  className="flex items-center gap-[10px] border-b border-linha-suave py-[7px] text-tinta no-underline last:border-b-0"
                >
                  <span className="flex-1 text-[12.5px]">{e.rotulo}</span>
                  <span className="h-[5px] w-[70px] shrink-0 rounded-full bg-fundo">
                    <span
                      className={`block h-[5px] rounded-full ${e.cor}`}
                      style={{ width: `${Math.round((n / maiorEtapa) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={`w-[26px] text-right font-mono text-[13px] font-semibold tabular-nums ${
                      e.etapa === "aberto" && n > 0 ? "text-critico" : ""
                    }`}
                  >
                    {n}
                  </span>
                </Link>
              );
            })}

            <div className="mt-[14px] border-t border-linha pt-3">
              <Rotulo>Risco de atraso</Rotulo>
              <div className="mt-2 flex gap-2">
                <Prazo
                  valor={p?.atrasados ?? 0}
                  texto="atrasados"
                  tom={(p?.atrasados ?? 0) > 0 ? "critico" : "neutro"}
                />
                <Prazo
                  valor={p?.vencendo_em_2h ?? 0}
                  texto="vencem em 2h"
                  tom={(p?.vencendo_em_2h ?? 0) > 0 ? "atencao" : "neutro"}
                />
                <Prazo valor={p?.vencendo_hoje ?? 0} texto="vencem hoje" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </Casca>
  );
}

function MelhorDia({ dias }: { dias: DiaDeVenda[] }) {
  if (dias.length === 0) return null;

  const valores = dias.map((d) => Number(d.total));
  const maior = Math.max(...valores);
  if (maior <= 0) return null;

  const quando = dias[valores.indexOf(maior)].dia;
  const legivel = new Date(`${quando}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <span className="ml-auto text-[12px] text-suave">
      melhor dia <b className="font-semibold text-tinta">{legivel}</b> —{" "}
      <span className="font-mono font-semibold text-tinta">{moeda(maior)}</span>
    </span>
  );
}

/**
 * O número sozinho não diz se está bom. A variação contra o período anterior
 * do mesmo tamanho é o que transforma um fato em informação.
 */
function Numero({
  rotulo,
  valor,
  antes,
  base,
  dias,
}: {
  rotulo: string;
  valor: string;
  antes: number;
  base: number;
  dias: number;
}) {
  const variacao = base > 0 ? Math.round(((antes - base) / base) * 100) : null;
  const subiu = (variacao ?? 0) > 0;

  return (
    <div className="rounded-[10px] border border-linha bg-superficie px-4 py-[14px]">
      <Rotulo>{rotulo}</Rotulo>
      <div className="mt-[6px] font-mono text-[26px] font-semibold tracking-[-0.03em] tabular-nums">
        {valor}
      </div>
      {variacao === null || variacao === 0 ? (
        <div className="mt-1 text-[11.5px] text-suave">
          {base > 0 ? "igual aos " : "sem "}
          {dias} dias anteriores
        </div>
      ) : (
        <div
          className={`mt-1 flex items-center gap-[5px] text-[11.5px] ${
            subiu ? "text-ok" : "text-critico"
          }`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={subiu ? "M7 14l5-5 5 5" : "M7 10l5 5 5-5"} />
          </svg>
          <b className="font-semibold">{Math.abs(variacao)}%</b>
          <span className="text-suave">vs. {dias} dias antes</span>
        </div>
      )}
    </div>
  );
}

/** Sem foto o espaço continua ocupado: lista desalinhada é pior de ler. */
function Foto({ url }: { url: string | null }) {
  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        className="block h-10 w-10 shrink-0 rounded-[7px] border border-linha object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[7px] border border-linha bg-fundo text-linha"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8 12 3 3 8l9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </svg>
    </span>
  );
}

function Prazo({
  valor,
  texto,
  tom = "neutro",
}: {
  valor: number;
  texto: string;
  tom?: "neutro" | "atencao" | "critico";
}) {
  const estilo =
    tom === "critico"
      ? "border-critico-linha bg-critico-bg text-critico"
      : tom === "atencao"
        ? "border-atencao-linha bg-atencao-bg text-atencao"
        : "border-linha";

  return (
    <span className={`flex-1 rounded-lg border px-[10px] py-2 ${estilo}`}>
      <b className="block font-mono text-[18px] font-semibold">{valor}</b>
      <span
        className={`mt-px block text-[11px] ${tom === "neutro" ? "text-suave" : ""}`}
      >
        {texto}
      </span>
    </span>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
      {children}
    </div>
  );
}
