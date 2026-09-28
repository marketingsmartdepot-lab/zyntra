import Link from "next/link";
import { hora, moeda, quando } from "./formato";
import { abrirSaida, fecharSaida } from "./acoes";

export type ModalidadeDeSaida = {
  id: string;
  nome: string;
  /** Quantas caixas estão na doca esperando por este destino. */
  na_doca: number;
  /** Já existe uma saída aberta para este destino? */
  ja_aberta: boolean;
};

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

export function EstacaoDeSaida({
  saidas,
  modalidades,
  veValores,
}: {
  saidas: SaidaResumo[];
  /** Os destinos que podem receber uma saída agora. */
  modalidades: ModalidadeDeSaida[];
  /** Sem isto o total de cada saída não aparece. */
  veValores: boolean;
}) {
  const abertas = saidas.filter((s) => s.situacao === "em_andamento");
  const fechadas = saidas.filter((s) => s.situacao !== "em_andamento");

  return (
    <div className="flex flex-col gap-6 p-5">
      <AbrirSaida modalidades={modalidades} />

      {saidas.length === 0 && (
        <p className="m-0 rounded-[9px] border border-linha px-4 py-10 text-center text-[13.5px] text-suave">
          Nenhuma saída ainda hoje. Abra uma quando o motorista chegar: ela
          reúne as caixas de um destino, e é nela que cada caixa é bipada ao ir
          para o caminhão.
        </p>
      )}

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
                {veValores && (
                  <span className="font-mono font-semibold tabular-nums">
                    {moeda(s.total)}
                  </span>
                )}
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

/**
 * Abrir a saída aqui, e não só a partir da Doca.
 *
 * Antes só se abria pelo cartão de um destino na Doca — e quem vem à Estação
 * de saída, que é onde o nome diz que isso acontece, encontrava um parágrafo
 * mandando ir para outra aba. Pior: com a doca vazia não havia cartão nenhum,
 * e a frente inteira parecia não existir.
 */
function AbrirSaida({ modalidades }: { modalidades: ModalidadeDeSaida[] }) {
  const livres = modalidades.filter((m) => !m.ja_aberta);

  return (
    <section className="rounded-[9px] border border-linha">
      <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        Abrir uma saída
      </h3>

      {livres.length === 0 ? (
        <p className="m-0 px-4 py-4 text-[12.5px] text-suave">
          {modalidades.length === 0
            ? "Nenhum destino cadastrado."
            : "Todos os destinos já têm uma saída aberta. Feche a que está em andamento antes de abrir outra do mesmo destino."}
        </p>
      ) : (
        <form
          action={abrirSaida}
          className="flex flex-wrap items-end gap-3 px-4 py-4"
        >
          <div>
            <label
              htmlFor="saida-modalidade"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Destino
            </label>
            <select
              id="saida-modalidade"
              name="modalidade"
              className="rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            >
              {livres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.na_doca > 0
                    ? ` — ${m.na_doca} ${m.na_doca === 1 ? "caixa" : "caixas"} na doca`
                    : " — nada na doca"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="saida-motorista"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Motorista
            </label>
            <input
              id="saida-motorista"
              name="motorista"
              placeholder="quem veio buscar"
              className="w-[220px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Abrir saída
          </button>

          <span className="max-w-[46ch] text-[12.5px] text-suave">
            Uma saída por destino de cada vez. Depois é bipar a etiqueta de cada
            caixa que entra no caminhão.
          </span>
        </form>
      )}
    </section>
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
            // Sem nenhum bipe não dá para afirmar nada sobre o custo. Dizer
            // "esta modalidade não tem custo" numa saída Flex vazia é mentira,
            // e mentira que só aparece quando alguém for conferir o mês.
            saida.pacotes === 0
              ? "nada bipado ainda"
              : saida.total > 0
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
