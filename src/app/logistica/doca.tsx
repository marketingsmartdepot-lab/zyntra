import Link from "next/link";
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

export type ItemDoCarrinho = {
  pacote_id: string;
  etapa: string;
  envio_ref: string | null;
  conta: string | null;
  modalidade: string;
  /** Um pacote pode levar mais de um pedido: venda em pack do ML. */
  pedidos: string | null;
  comprador: string | null;
  ja_saiu: boolean;
  saiu_em: string | null;
};

export type EntregaResumo = {
  id: string;
  codigo: string;
  entregue_por: string;
  entregue_em: string;
  pacotes: number;
  ja_sairam: number;
  /** O carrinho É uma lista de separação, e não um agrupamento à mão. */
  e_uma_lista: boolean;
};

/**
 * Os carrinhos do dia, e o que foi dentro deles.
 *
 * O resumo dizia "6 caixas" e nao dizia QUAIS — e quando uma caixa nao chega
 * no cliente, "6 caixas" nao ajuda ninguem. Clicar no carrinho abre a lista
 * dos pedidos que ele levou, inclusive os que ja sairam: o carrinho e o
 * registro de quem estava com a caixa, e esse registro so serve completo.
 */
function EntregasDoDia({
  entregas,
  carrinhoAberto,
  itens,
}: {
  entregas: EntregaResumo[];
  carrinhoAberto: string | null;
  itens: ItemDoCarrinho[];
}) {
  if (entregas.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        Carrinhos de hoje
      </h3>
      <div className="flex flex-col gap-1">
        {entregas.map((e) => {
          const aberto = carrinhoAberto === e.id;

          return (
            <div key={e.id}>
              <Link
                href={
                  aberto
                    ? "/logistica?aba=doca"
                    : `/logistica?aba=doca&carrinho=${e.id}`
                }
                aria-expanded={aberto}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 border border-linha px-4 py-[9px] text-[12.5px] no-underline ${
                  aberto
                    ? "rounded-t-lg border-b-0 bg-fundo"
                    : "rounded-lg hover:bg-fundo"
                }`}
              >
                <span className="font-mono font-semibold">{e.codigo}</span>
                {e.e_uma_lista && (
                  <span className="rounded-md border border-linha px-[8px] py-[2px] text-[11px] font-semibold text-suave">
                    lista de separação
                  </span>
                )}
                {/*
                  Rotulado, e nao cinza solto. Entre o codigo do carrinho e a
                  contagem de caixas, um nome sem rotulo nao se le como "quem
                  levou" — e esse nome e justamente o que se procura quando
                  uma caixa nao chega.
                */}
                <span className="text-suave">
                  levado por{" "}
                  <b className="font-semibold text-tinta">{e.entregue_por}</b>
                </span>
                <span className="text-suave">
                  {e.pacotes} {e.pacotes === 1 ? "caixa" : "caixas"}
                  {e.ja_sairam > 0 && ` · ${e.ja_sairam} já saíram`}
                </span>
                <span className="flex-1" />
                <span className="text-suave">{quando(e.entregue_em)}</span>
                <span aria-hidden className="text-suave">
                  {aberto ? "fechar" : "ver pedidos"}
                </span>
              </Link>

              {aberto && <PedidosDoCarrinho entrega={e} itens={itens} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Doca({
  veValores,
  destinos,
  entregas,
  carrinhoAberto,
  itensDoCarrinho,
}: {
  /** Sem isto o custo previsto não aparece. */
  veValores: boolean;
  destinos: Destino[];
  entregas: EntregaResumo[];
  /** Qual carrinho está com a lista de pedidos aberta, se algum. */
  carrinhoAberto: string | null;
  itensDoCarrinho: ItemDoCarrinho[];
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
            lacrado. O carrinho é a lista de separação: ele se enche sozinho a
            cada "Finalizar e próximo" na bancada.
          </p>
        </div>
        <EntregasDoDia
          entregas={entregas}
          carrinhoAberto={carrinhoAberto}
          itens={itensDoCarrinho}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
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

            {veValores && d.pacotes_com_custo > 0 ? (
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

      <EntregasDoDia
          entregas={entregas}
          carrinhoAberto={carrinhoAberto}
          itens={itensDoCarrinho}
        />
    </div>
  );
}

/**
 * Os pedidos que foram num carrinho.
 *
 * Mostra tambem os que ja sairam, com a marca de que sairam: o numero no
 * resumo conta as 6 caixas, e uma lista de 4 embaixo de um "6 caixas" faria
 * qualquer pessoa achar que perdeu duas.
 */
function PedidosDoCarrinho({
  entrega,
  itens,
}: {
  entrega: EntregaResumo;
  itens: ItemDoCarrinho[];
}) {
  // O nome de quem levou se repete aqui de propósito: quem abriu a lista está
  // lendo pedidos, e é nesse momento que a pergunta "quem estava com essa
  // caixa?" aparece. Fazer a pessoa fechar o painel para reler o nome lá em
  // cima é o tipo de ida e volta que faz ninguém usar a tela.
  const cabecalho = (
    <p className="m-0 border-b border-linha bg-fundo px-4 py-[9px] text-[12.5px] text-suave">
      Levado para a doca por{" "}
      <b className="font-semibold text-tinta">{entrega.entregue_por}</b>
      {" · "}
      {quando(entrega.entregue_em)}
      {entrega.e_uma_lista && " · carrinho é a lista de separação"}
    </p>
  );

  if (itens.length === 0) {
    return (
      <div className="rounded-b-lg border border-linha">
        {cabecalho}
        <p className="m-0 px-4 py-3 text-[12.5px] text-suave">
          Este carrinho está vazio.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-b-lg border border-linha">
      {cabecalho}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Pedido", "Comprador", "Conta", "Modalidade", "Envio", ""].map(
              (c) => (
                <th
                  key={c}
                  className="border-b border-linha px-4 py-[8px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                >
                  {c}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.pacote_id}>
              <td className="border-b border-linha-suave px-4 py-2 font-mono text-[12.5px]">
                {i.pedidos ?? "—"}
              </td>
              <td className="border-b border-linha-suave px-4 py-2 text-[12.5px]">
                {i.comprador ?? "—"}
              </td>
              <td className="border-b border-linha-suave px-4 py-2 text-[12.5px] text-suave">
                {i.conta ?? "—"}
              </td>
              <td className="border-b border-linha-suave px-4 py-2 text-[12.5px] text-suave">
                {i.modalidade}
              </td>
              <td className="border-b border-linha-suave px-4 py-2 font-mono text-[12px] text-suave">
                {i.envio_ref ?? "—"}
              </td>
              <td className="border-b border-linha-suave px-4 py-2 text-right text-[11.5px]">
                {i.ja_saiu ? (
                  <span className="font-semibold text-ok">
                    saiu{i.saiu_em ? ` · ${quando(i.saiu_em)}` : ""}
                  </span>
                ) : (
                  <span className="text-suave">na doca</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
