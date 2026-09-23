import Link from "next/link";
import { redirect } from "next/navigation";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Painel — ZYNTRA" };

const ORDEM = [
  { etapa: "aberto", rotulo: "Aberto" },
  { etapa: "faturado", rotulo: "Faturado" },
  { etapa: "separar", rotulo: "Separar" },
  { etapa: "conferir", rotulo: "Conferir" },
  { etapa: "pronto", rotulo: "Pronto pra envio" },
  { etapa: "retido", rotulo: "Retidos" },
];

export default async function PaginaPainel() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/painel");

  const [volumes, prazos, urgentes, separacao, bancada] = await Promise.all([
    supabase.from("painel_volumes").select("*"),
    supabase.from("painel_prazos").select("*").maybeSingle(),
    supabase.from("painel_urgentes").select("*").limit(8),
    supabase.from("painel_separacao").select("*").maybeSingle(),
    supabase.from("painel_bancada").select("*").maybeSingle(),
  ]);

  const porEtapa = new Map<string, { pacotes: number; unidades: number }>();
  for (const v of (volumes.data ?? []) as Vol[]) {
    porEtapa.set(v.etapa, { pacotes: v.pacotes, unidades: v.unidades });
  }
  const totalNaEsteira = ORDEM.filter((o) => o.etapa !== "retido").reduce(
    (t, o) => t + (porEtapa.get(o.etapa)?.pacotes ?? 0),
    0,
  );

  const p = prazos.data as Prazos | null;
  const s = separacao.data as Separacao | null;
  const b = bancada.data as Bancada | null;
  const lista = (urgentes.data ?? []) as Urgente[];

  const semNada = totalNaEsteira === 0;

  return (
    <Casca frente="painel" email={user.email ?? "sem e-mail"}>
      <div className="flex shrink-0 items-center gap-3 border-b border-linha bg-superficie px-5 py-4">
        <h1 className="m-0 text-[17px] font-bold tracking-[-0.02em]">
          Painel operacional
        </h1>
        <p className="text-[12.5px] text-suave">
          Tudo aqui é calculado na hora. Nenhum número fica guardado em coluna —
          contador desatualiza e passa a mentir.
        </p>
        <span className="flex-1" />
        <Link
          href="/expedicao"
          className="rounded-lg border border-linha px-3 py-[7px] text-[12.5px] font-semibold text-tinta no-underline"
        >
          Ir para a esteira
        </Link>
      </div>

      {semNada ? (
        <div className="flex flex-1 items-center justify-center px-6 py-20">
          <div className="max-w-[52ch] text-center">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">
              A esteira está parada
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-suave">
              Nenhum pacote em nenhuma etapa. O painel só ganha sentido quando a
              primeira conta estiver conectada — até lá ele mostra zero, que é a
              verdade.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 p-5">
        <section>
          <Titulo>Volume por etapa</Titulo>
          <div className="flex flex-wrap gap-3">
            {ORDEM.map((o) => {
              const v = porEtapa.get(o.etapa);
              const alerta =
                (o.etapa === "aberto" || o.etapa === "retido") &&
                (v?.pacotes ?? 0) > 0;
              return (
                <Link
                  key={o.etapa}
                  href={`/expedicao?etapa=${o.etapa}`}
                  className={`min-w-[152px] flex-1 rounded-[10px] border p-4 no-underline ${
                    alerta ? "border-critico-linha bg-critico-bg" : "border-linha"
                  }`}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
                    {o.rotulo}
                  </div>
                  <div
                    className={`mt-[5px] font-mono text-[30px] font-semibold tracking-[-0.03em] tabular-nums ${
                      alerta ? "text-critico" : "text-tinta"
                    }`}
                  >
                    {v?.pacotes ?? 0}
                  </div>
                  <div className="mt-1 text-[11.5px] text-suave">
                    {v?.unidades ?? 0} unidades
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <Titulo>Risco de atraso</Titulo>
          <p className="mb-3 text-[12.5px] text-suave">
            Só o que ainda está na esteira. Pronto e retido ficam de fora: um já
            saiu da corrida, o outro parou.
          </p>
          <div className="flex flex-wrap gap-3">
            <Tile
              rotulo="Atrasados"
              valor={p?.atrasados ?? 0}
              tom={(p?.atrasados ?? 0) > 0 ? "critico" : "neutro"}
            />
            <Tile
              rotulo="Vencem em 2h"
              valor={p?.vencendo_em_2h ?? 0}
              tom={(p?.vencendo_em_2h ?? 0) > 0 ? "atencao" : "neutro"}
            />
            <Tile rotulo="Vencem hoje" valor={p?.vencendo_hoje ?? 0} />
            <Tile
              rotulo="Sem prazo do canal"
              valor={p?.sem_prazo ?? 0}
              nota="envio combinado ou modalidade sem prazo"
            />
          </div>
        </section>

        {lista.length > 0 && (
          <section>
            <Titulo>Os mais apertados</Titulo>
            <div className="overflow-x-auto rounded-[9px] border border-linha">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Código", "Conta", "Etapa", "Modalidade", "Limite"].map(
                      (c) => (
                        <th
                          key={c}
                          className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                        >
                          {c}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((u) => {
                    const atrasado =
                      new Date(u.limite_envio_em).getTime() < Date.now();
                    return (
                      <tr key={u.id}>
                        <td className="border-b border-linha-suave px-4 py-[10px]">
                          <Link
                            href={`/expedicao?etapa=${u.etapa}&pacote=${u.id}`}
                            className="font-mono text-[12.5px] font-medium text-tinta underline decoration-linha underline-offset-[3px]"
                          >
                            {u.codigo ?? "—"}
                          </Link>
                        </td>
                        <td className="border-b border-linha-suave px-4 py-[10px] text-[12.5px]">
                          {u.conta}
                        </td>
                        <td className="border-b border-linha-suave px-4 py-[10px] text-[12.5px]">
                          {ORDEM.find((o) => o.etapa === u.etapa)?.rotulo ??
                            u.etapa}
                        </td>
                        <td className="border-b border-linha-suave px-4 py-[10px] text-[12.5px]">
                          {u.modalidade}
                        </td>
                        <td
                          className={`border-b border-linha-suave px-4 py-[10px] text-[12.5px] font-semibold ${
                            atrasado ? "text-critico" : ""
                          }`}
                        >
                          {new Date(u.limite_envio_em).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: "America/Sao_Paulo",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <Titulo>Corredor e bancada</Titulo>
          <div className="flex flex-wrap gap-3">
            <Tile rotulo="Listas aguardando" valor={s?.listas_aguardando ?? 0} />
            <Tile rotulo="Listas em execução" valor={s?.listas_em_execucao ?? 0} />
            <Tile
              rotulo="Conferências abertas"
              valor={b?.conferencias_abertas ?? 0}
            />
            <Tile
              rotulo="Divergências"
              valor={b?.divergencias_abertas ?? 0}
              tom={(b?.divergencias_abertas ?? 0) > 0 ? "critico" : "neutro"}
              nota="esperando liberação de líder"
            />
            <Tile
              rotulo="Agentes offline"
              valor={b?.agentes_offline ?? 0}
              tom={(b?.agentes_offline ?? 0) > 0 ? "critico" : "neutro"}
              nota="sem agente não há impressão"
            />
          </div>
        </section>
      </div>
    </Casca>
  );
}

type Vol = { etapa: string; pacotes: number; unidades: number };
type Prazos = {
  atrasados: number;
  vencendo_em_2h: number;
  vencendo_hoje: number;
  sem_prazo: number;
};
type Separacao = { listas_aguardando: number; listas_em_execucao: number };
type Bancada = {
  conferencias_abertas: number;
  divergencias_abertas: number;
  agentes_offline: number;
};
type Urgente = {
  id: string;
  etapa: string;
  limite_envio_em: string;
  modalidade: string;
  conta: string;
  codigo: string | null;
};

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-0 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
      {children}
    </h2>
  );
}

function Tile({
  rotulo,
  valor,
  nota,
  tom = "neutro",
}: {
  rotulo: string;
  valor: number;
  nota?: string;
  tom?: "neutro" | "atencao" | "critico";
}) {
  const borda =
    tom === "critico"
      ? "border-critico-linha bg-critico-bg"
      : tom === "atencao"
        ? "border-atencao-linha bg-atencao-bg"
        : "border-linha";
  const cor =
    tom === "critico"
      ? "text-critico"
      : tom === "atencao"
        ? "text-atencao"
        : "text-tinta";

  return (
    <div className={`min-w-[168px] flex-1 rounded-[10px] border p-4 ${borda}`}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        {rotulo}
      </div>
      <div
        className={`mt-[5px] font-mono text-[30px] font-semibold tracking-[-0.03em] tabular-nums ${cor}`}
      >
        {valor}
      </div>
      {nota && <div className="mt-1 text-[11.5px] text-suave">{nota}</div>}
    </div>
  );
}
