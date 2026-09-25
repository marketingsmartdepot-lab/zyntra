import { moeda, quando } from "./formato";
import Link from "next/link";
import { abrirSaida } from "./acoes";
import { AbrirCarrinho } from "./abrir-carrinho";

export type Destino = {
  modalidade_id: string | null;
  modalidade: string;
  tem_janela_coleta: boolean | null;
  pacotes: number;
  pacotes_com_custo: number;
  custo_previsto: number;
  mais_antigo: string | null;
  prazo_mais_apertado: string | null;
};

export type EntregaResumo = {
  id: string;
  codigo: string;
  entregue_por: string;
  entregue_em: string;
  pacotes: number;
  ja_sairam: number;
};

function EntregasDoDia({ entregas }: { entregas: EntregaResumo[] }) {
  if (entregas.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        Entregas de hoje
      </h3>
      <div className="flex flex-col gap-1">
        {entregas.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-linha px-4 py-[9px] text-[12.5px]"
          >
            <span className="font-mono font-semibold">{e.codigo}</span>
            <span className="text-suave">{e.entregue_por}</span>
            <span className="text-suave">
              {e.pacotes} {e.pacotes === 1 ? "caixa" : "caixas"}
              {e.ja_sairam > 0 && ` · ${e.ja_sairam} já saíram`}
            </span>
            <span className="flex-1" />
            <span className="text-suave">{quando(e.entregue_em)}</span>
            <Link
              href={`/logistica?aba=doca&entrega=${e.id}&bipar=1`}
              className="font-semibold text-tinta no-underline"
            >
              Continuar bipando
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Doca({
  destinos,
  entregas,
}: {
  destinos: Destino[];
  entregas: EntregaResumo[];
}) {
  if (destinos.length === 0) {
    return (
      <div className="flex flex-col gap-5 p-5">
        <div className="py-8 text-center">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">
            A doca está vazia
          </h2>
          <p className="mx-auto mt-3 max-w-[52ch] text-[14px] leading-relaxed text-suave">
            Só aparece aqui o que a Expedição entregar depois de conferido e
            lacrado. É por este carrinho que a caixa chega.
          </p>
        </div>
        <AbrirCarrinho />
        <EntregasDoDia entregas={entregas} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <AbrirCarrinho />

      {destinos.map((d) => (
        <section
          key={d.modalidade_id ?? d.modalidade}
          className="overflow-hidden rounded-[9px] border border-linha"
        >
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linha bg-fundo px-4 py-3">
            <h3 className="text-[15px] font-bold tracking-[-0.01em]">
              {d.modalidade}
            </h3>
            <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
              {d.tem_janela_coleta ? "janela de coleta" : "saída contínua"}
            </span>
            <span className="text-[12px] text-suave">
              {d.pacotes} {d.pacotes === 1 ? "pacote" : "pacotes"}
              {d.mais_antigo && ` · o mais antigo ${quando(d.mais_antigo)}`}
            </span>

            <span className="flex-1" />

            {d.pacotes_com_custo > 0 ? (
              <span className="text-right">
                <span className="font-mono text-[16px] font-semibold tabular-nums">
                  {moeda(d.custo_previsto)}
                </span>
                <span className="ml-2 text-[12px] text-suave">
                  previstos · {d.pacotes_com_custo} × etiqueta
                </span>
              </span>
            ) : (
              <span className="text-[12px] text-suave">
                sem custo de etiqueta
              </span>
            )}

            {/*
              O nome de quem leva é pedido na abertura, uma vez por carga, e
              não a cada pacote: é uma pessoa só puxando o carrinho.
            */}
            <form action={abrirSaida} className="flex items-center gap-2">
              <input
                type="hidden"
                name="modalidade"
                value={d.modalidade_id ?? ""}
              />
              <input
                name="motorista"
                placeholder="quem está levando"
                aria-label={`Quem está levando os pacotes de ${d.modalidade}`}
                className="w-[168px] rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[12.5px]"
              />
              <button
                type="submit"
                disabled={!d.modalidade_id}
                className="rounded-lg bg-tinta px-3 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                Abrir estação de saída
              </button>
            </form>
          </header>

          <p className="px-4 py-3 text-[12.5px] text-suave">
            O valor só é contado quando o pacote é <b>bipado na saída</b>.
            Estar na doca ainda não conta.
          </p>
        </section>
      ))}

      <EntregasDoDia entregas={entregas} />
    </div>
  );
}
