import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import { imprimirLista } from "./acoes";

type Resumo = {
  id: string;
  codigo: string;
  situacao: string;
  criada_em: string;
  separador: string | null;
  gerada_por: string | null;
  pacotes: number;
  unidades: number;
  contas: number;
};

type Pedido = {
  pacote_id: string;
  codigo: string;
  etapa: string;
  unidades: number | null;
  conta: string;
  canal: string;
};

type Item = {
  sku_id: string;
  codigo: string;
  descricao: string;
  codigo_barras: string | null;
  unidades: number;
  pacotes: number;
};

export async function PainelListas({
  listaId,
  impressao,
}: {
  listaId?: string;
  impressao?: string;
}) {
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("listas_resumo")
    .select("*")
    .order("criada_em", { ascending: false })
    .limit(60);

  const listas = (data ?? []) as Resumo[];

  // A lista não tem mais início e fim: ela nasce emitida, o papel sai e os
  // pedidos já foram para Conferir. O que separa uma da outra é a data —
  // quem abre esta aba está procurando "a lista de hoje de manhã".
  const hoje = new Date().toDateString();
  const doDia = listas.filter((l) => new Date(l.criada_em).toDateString() === hoje);
  const anteriores = listas.filter(
    (l) => new Date(l.criada_em).toDateString() !== hoje,
  );

  const aberta =
    (listaId && listas.find((l) => l.id === listaId)) || listas[0] || null;

  if (listas.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="max-w-[52ch] text-center">
          <h2 className="text-[20px] font-bold tracking-[-0.02em]">
            Nenhuma lista de separação
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-suave">
            As listas nascem na aba Separar: você marca os pacotes e gera a
            lista. O papel sai na impressora e os pedidos vão direto para
            Conferir. Esta aba guarda o registro de cada uma — quais pedidos
            entraram e quem gerou.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <aside className="w-[250px] shrink-0 border-r border-linha bg-fundo p-[14px]">
        <Grupo titulo="Hoje" listas={doDia} ativa={aberta?.id} />
        {anteriores.length > 0 && (
          <Grupo
            titulo="Anteriores"
            listas={anteriores.slice(0, 20)}
            ativa={aberta?.id}
            apagada
          />
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {aberta ? (
          <ListaAberta lista={aberta} impressao={impressao} />
        ) : (
          <p className="p-6 text-[13.5px] text-suave">
            Escolha uma lista à esquerda.
          </p>
        )}
      </section>
    </div>
  );
}

function Grupo({
  titulo,
  listas,
  ativa,
  apagada,
}: {
  titulo: string;
  listas: Resumo[];
  ativa?: string;
  apagada?: boolean;
}) {
  if (listas.length === 0) return null;
  return (
    <>
      <h4 className="mb-[10px] mt-[18px] text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave first:mt-0">
        {titulo}
      </h4>
      {listas.map((l) => (
        <Link
          key={l.id}
          href={`/expedicao?etapa=listas&lista=${l.id}`}
          className={`mb-[9px] block rounded-lg border bg-superficie px-3 py-[11px] no-underline ${
            l.id === ativa ? "border-tinta shadow-[0_0_0_1px_var(--color-tinta)]" : "border-linha"
          } ${apagada ? "opacity-60" : ""}`}
        >
          <span className="block font-mono text-[13px] font-semibold">
            {l.codigo}
          </span>
          <span className="mt-[3px] block text-[11.5px] text-suave">
            {rotuloSituacao(l.situacao)}
            {l.separador && ` · ${l.separador}`}
            <br />
            {l.pacotes} {l.pacotes === 1 ? "pacote" : "pacotes"} · {l.unidades}{" "}
            un
          </span>
        </Link>
      ))}
    </>
  );
}

async function ListaAberta({
  lista,
  impressao,
}: {
  lista: Resumo;
  impressao?: string;
}) {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("listas_itens")
    .select("*")
    .eq("lista_id", lista.id)
    .order("codigo");

  const itens = (data ?? []) as Item[];

  return (
    <>
      <header className="flex flex-wrap items-center gap-4 border-b border-linha px-5 py-4">
        <div>
          <h2 className="m-0 text-[19px] font-bold tracking-[-0.02em]">
            Lista {lista.codigo}
          </h2>
          <p className="mt-[2px] text-[12.5px] text-suave">
            {rotuloSituacao(lista.situacao)} {quando(lista.criada_em)} ·{" "}
            {lista.pacotes} {lista.pacotes === 1 ? "pedido" : "pedidos"} ·{" "}
            {lista.contas} {lista.contas === 1 ? "conta" : "contas"}
          </p>
          <p className="mt-[2px] text-[12.5px] text-suave">
            {/* O registro: quem estava no turno quando o papel saiu, e quem
                clicou. Nem sempre são a mesma pessoa. */}
            Separador:{" "}
            <b className="font-semibold text-tinta">
              {lista.separador ?? "sem turno aberto na bancada"}
            </b>
            {lista.gerada_por && ` · gerada por ${lista.gerada_por}`}
          </p>
        </div>

        <span className="flex-1" />

        <div className="text-right">
          <div className="font-mono text-[26px] font-semibold tracking-[-0.03em] tabular-nums">
            {lista.unidades}
          </div>
          <div className="text-[12.5px] text-suave">unidades na lista</div>
        </div>

        {/* A única ação que sobrou. Não há "concluir": os pedidos já foram
            para Conferir no momento em que a lista foi gerada. */}
        <form action={imprimirLista}>
          <input type="hidden" name="lista" value={lista.id} />
          <button
            type="submit"
            className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
          >
            Reimprimir folha
          </button>
        </form>
      </header>

      {impressao && <AvisoImpressao resultado={impressao} />}

      {itens.length === 0 ? (
        <p className="px-5 py-8 text-[13.5px] text-suave">
          Nenhum item consolidado. Isso acontece quando os anúncios dos pacotes
          ainda não têm SKU mapeado — sem SKU, não há o que buscar no corredor.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["SKU", "Produto", "Unidades", "Em quantos pacotes"].map(
                  (c, i) => (
                    <th
                      key={c}
                      style={
                        i === 2
                          ? { width: "120px" }
                          : i === 3
                            ? { width: "180px" }
                            : i === 0
                              ? { width: "180px" }
                              : undefined
                      }
                      className="border-b border-linha px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.sku_id}>
                  <td className="border-b border-linha-suave px-4 py-3">
                    <span className="font-mono text-[13px] font-semibold">
                      {i.codigo}
                    </span>
                    <span className="mt-[2px] block font-mono text-[11.5px] text-suave">
                      {i.codigo_barras ?? "sem código de barras"}
                    </span>
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 text-[13.5px] font-medium">
                    {i.descricao}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 font-mono text-[24px] font-semibold tabular-nums">
                    {i.unidades}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 text-[12.5px] text-suave">
                    {i.pacotes} {i.pacotes === 1 ? "pacote" : "pacotes"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PedidosDaLista listaId={lista.id} />

      <p className="mt-auto border-t border-linha bg-fundo px-5 py-4 text-[12.5px] text-suave">
        Sem endereço de prateleira nesta versão — o estoque fica na Lexos, então
        o sistema não conhece a localização. <b>Esta lista não substitui a
        conferência</b>: cada pedido ainda passa pela bancada um a um.
      </p>
    </>
  );
}

/**
 * Os pedidos que entraram nesta lista, e onde cada um está hoje.
 *
 * É este o motivo da aba existir. Quando uma caixa some, vem trocada ou o
 * cliente reclama, a pergunta é sempre a mesma: quem pegou este pedido e com
 * qual lista? A resposta está aqui — o papel do corredor some, o registro não.
 */
async function PedidosDaLista({ listaId }: { listaId: string }) {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("listas_pacotes_resumo")
    .select("*")
    .eq("lista_id", listaId)
    .order("codigo");

  const pedidos = (data ?? []) as Pedido[];
  if (pedidos.length === 0) return null;

  return (
    <section className="border-t border-linha">
      <h3 className="m-0 px-5 pb-2 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        Pedidos desta lista
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Pedido", "Conta", "Canal", "Unidades", "Onde está hoje"].map(
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
            {pedidos.map((p) => (
              <tr key={p.pacote_id}>
                <td className="border-b border-linha-suave px-4 py-[10px] font-mono text-[13px] font-semibold">
                  {p.codigo}
                </td>
                <td className="border-b border-linha-suave px-4 py-[10px] text-[13px]">
                  {p.conta}
                </td>
                <td className="border-b border-linha-suave px-4 py-[10px] text-[12.5px] text-suave">
                  {p.canal}
                </td>
                <td className="border-b border-linha-suave px-4 py-[10px] font-mono text-[13px] tabular-nums">
                  {p.unidades ?? "—"}
                </td>
                <td className="border-b border-linha-suave px-4 py-[10px]">
                  <span className="rounded-md border border-linha bg-fundo px-[9px] py-[3px] text-[12px] font-semibold">
                    {rotuloEtapa(p.etapa)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function rotuloEtapa(e: string) {
  const nomes: Record<string, string> = {
    aberto: "Aberto",
    faturado: "Faturado",
    separar: "Separar",
    conferir: "Conferir",
    pronto: "Pronto pra envio",
    retido: "Retido",
    encerrado: "Encerrado",
  };
  return nomes[e] ?? e;
}

/** Data e hora curtas, no fuso do galpão. */
function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function rotuloSituacao(s: string) {
  return s === "cancelada" ? "Cancelada" : "Emitida";
}

/**
 * O que aconteceu com o pedido de impressão, dito por inteiro.
 *
 * Cada recusa aponta para a coisa que precisa ser resolvida, porque "falhou ao
 * imprimir" manda o operador chamar alguém em vez de resolver sozinho.
 */
function AvisoImpressao({ resultado }: { resultado: string }) {
  if (resultado === "ok") {
    return (
      <p className="border-b border-ok-linha bg-ok-bg px-5 py-[10px] text-[12.5px] font-semibold text-ok">
        Folha enviada para a impressora desta bancada.
      </p>
    );
  }

  const texto: Record<string, string> = {
    agente_offline:
      "O agente desta bancada não está respondendo. Sem ele o computador não fala com a impressora — confira se o programa está rodando na máquina.",
    estacao_sem_impressora:
      "Esta bancada não tem impressora cadastrada. Cadastre em Integração.",
    estacao_nao_informada:
      "Esta máquina ainda não sabe qual bancada é. Escolha em Qual bancada é esta.",
    sem_conteudo:
      "A folha saiu vazia, então nada foi enfileirado. Isso acontece quando nenhum item da lista tem SKU mapeado.",
    lista_nao_encontrada: "Esta lista não existe mais.",
    sem_bancada:
      "A lista foi gerada e os pedidos já estão em Conferir, mas esta máquina ainda não sabe qual bancada é — por isso o papel não saiu. Escolha a bancada e use Reimprimir folha.",
  };

  return (
    <p className="border-b border-critico-linha bg-critico-bg px-5 py-[10px] text-[12.5px] font-semibold text-critico">
      {texto[resultado] ?? "Não foi possível enviar para a impressora."}
    </p>
  );
}
