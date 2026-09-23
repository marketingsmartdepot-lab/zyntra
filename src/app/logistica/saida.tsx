import Link from "next/link";
import { hora, moeda, quando } from "./formato";
import { fecharSaida } from "./acoes";

export type SaidaResumo = {
  id: string;
  codigo: string;
  situacao: string;
  motorista: string | null;
  aberta_em: string;
  fechada_em: string | null;
  modalidade: string;
  pacotes: number;
  total: number;
  na_doca: number;
};

export function EstacaoDeSaida({ saidas }: { saidas: SaidaResumo[] }) {
  const abertas = saidas.filter((s) => s.situacao === "em_andamento");
  const fechadas = saidas.filter((s) => s.situacao !== "em_andamento");

  if (saidas.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-20">
        <div className="max-w-[52ch] text-center">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">
            Nenhuma saída aberta
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-suave">
            Uma saída reúne os pacotes de um destino e é onde acontece a segunda
            bipagem. Ela é aberta a partir de um grupo da Doca, quando o
            motorista chega.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      {abertas.length > 0 && (
        <section>
          <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Em andamento
          </h3>
          <div className="flex flex-col gap-3">
            {abertas.map((s) => (
              <Cartao key={s.id} saida={s} />
            ))}
          </div>
        </section>
      )}

      {fechadas.length > 0 && (
        <section>
          <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Fechadas
          </h3>
          <div className="flex flex-col gap-2">
            {fechadas.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-linha px-4 py-3 text-[12.5px]"
              >
                <span className="font-mono font-semibold">{s.codigo}</span>
                <span className="text-suave">{s.modalidade}</span>
                <span className="text-suave">
                  {s.pacotes} {s.pacotes === 1 ? "pacote" : "pacotes"}
                </span>
                {s.motorista && (
                  <span className="text-suave">
                    recebida por {s.motorista}
                  </span>
                )}
                <span className="flex-1" />
                <span className="font-mono font-semibold tabular-nums">
                  {moeda(s.total)}
                </span>
                {s.fechada_em && (
                  <span className="text-suave">
                    fechada {hora(s.fechada_em)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Cartao({ saida }: { saida: SaidaResumo }) {
  const faltam = saida.na_doca;

  return (
    <article className="overflow-hidden rounded-[9px] border border-linha">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha bg-fundo px-4 py-3">
        <h4 className="font-mono text-[15px] font-bold tracking-[-0.01em]">
          {saida.codigo}
        </h4>
        <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
          {saida.modalidade}
        </span>
        <span className="text-[12px] text-suave">
          aberta {quando(saida.aberta_em)}
          {saida.motorista && ` · motorista ${saida.motorista}`}
        </span>
        <span className="flex-1" />
        <form action={fecharSaida}>
          <input type="hidden" name="saida" value={saida.id} />
          <button
            type="submit"
            disabled={saida.pacotes === 0}
            title={
              saida.pacotes === 0
                ? "Nada bipado ainda — não há o que fechar"
                : undefined
            }
            className="rounded-lg border border-linha px-3 py-[7px] text-[12.5px] font-semibold disabled:opacity-50"
          >
            Fechar saída
          </button>
        </form>
        <Link
          href={`/logistica?aba=saida&saida=${saida.id}&bipar=1`}
          className="rounded-lg bg-tinta px-3 py-[7px] text-[12.5px] font-semibold text-white no-underline"
        >
          Abrir bancada de saída
        </Link>
      </header>

      <div className="flex flex-wrap gap-3 p-4">
        <Tile rotulo="Bipados" valor={String(saida.pacotes)} />
        <Tile
          rotulo="Ainda na doca"
          valor={String(faltam)}
          nota={faltam > 0 ? "esperando bipe" : "nada pendente"}
        />
        <Tile
          rotulo="Acumulado nesta saída"
          valor={moeda(saida.total)}
          destaque
          nota={
            saida.total > 0
              ? "valores congelados no bipe"
              : "esta modalidade não tem custo"
          }
        />
      </div>
    </article>
  );
}

function Tile({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`min-w-[170px] flex-1 rounded-[10px] border p-4 ${
        destaque ? "border-tinta bg-tinta text-white" : "border-linha"
      }`}
    >
      <div
        className={`text-[10.5px] font-semibold uppercase tracking-[0.13em] ${
          destaque ? "text-[#A9AEB6]" : "text-suave"
        }`}
      >
        {rotulo}
      </div>
      <div className="mt-[5px] font-mono text-[28px] font-semibold tracking-[-0.03em] tabular-nums">
        {valor}
      </div>
      {nota && (
        <div
          className={`mt-1 text-[11.5px] ${destaque ? "text-[#A9AEB6]" : "text-suave"}`}
        >
          {nota}
        </div>
      )}
    </div>
  );
}
