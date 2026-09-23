import { moeda, quando } from "./formato";
import { abrirSaida } from "./acoes";

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

export function Doca({ destinos }: { destinos: Destino[] }) {
  if (destinos.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-20">
        <div className="max-w-[52ch] text-center">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">
            A doca está vazia
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-suave">
            Só aparece aqui o que a Expedição entregar depois de conferido e
            lacrado. Enquanto a esteira não roda, não há saída para registrar
            nem etiqueta para contar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-5">
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
    </div>
  );
}
