import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { Etapa } from "@/lib/supabase/tipos";
import { Bancada, type ItemConferido } from "./bancada";
import { iniciarConferencia } from "./acoes";
import { turnoDaMaquina } from "@/lib/estacao";
import type { DivergenciaAberta, Lider } from "./divergencia";

type PacoteNaFila = {
  id: string;
  etapa: Etapa;
  etapa_desde: string;
  unidades_esperadas: number | null;
  envios: {
    ref_externa: string;
    limite_envio_em: string | null;
    etiqueta_obtida_em: string | null;
    modalidades: { nome: string } | null;
    pedidos: { ref_externa: string; pack_ref: string | null }[];
  } | null;
  contas: { apelido: string; empresas: { nome_curto: string } | null } | null;
};

/**
 * O painel só aparece quando alguém clica num pedido. Sem seleção, a aba
 * ocupa a tela inteira — metade de tela vazia esperando clique não ajuda
 * ninguém.
 */
export async function PainelDetalhe({
  fila,
  pacoteId,
  etapa,
  liberacao,
}: {
  fila: PacoteNaFila[];
  pacoteId: string;
  etapa: Etapa;
  liberacao?: string;
}) {
  const selecionado = fila.find((p) => p.id === pacoteId) ?? null;

  return (
    <div className="flex flex-1">
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-linha">
        <div className="flex items-center gap-2 border-b border-linha bg-fundo px-4 py-[10px] text-[12px] text-suave">
          <b className="font-semibold text-tinta">{fila.length}</b>
          {fila.length === 1 ? " pacote" : " pacotes"}
          <span className="flex-1" />
          <Link
            href={`/expedicao?etapa=${etapa}`}
            className="text-[12px] font-semibold text-tinta no-underline"
          >
            Ver lista inteira
          </Link>
        </div>

        <ul className="m-0 list-none overflow-y-auto p-0">
          {fila.map((p) => {
            const ativo = p.id === pacoteId;
            const pedidos = p.envios?.pedidos ?? [];
            return (
              <li key={p.id}>
                <Link
                  href={`/expedicao?etapa=${etapa}&pacote=${p.id}`}
                  aria-current={ativo ? "true" : undefined}
                  className={`flex items-center gap-3 border-b border-linha-suave px-4 py-[10px] no-underline ${
                    ativo
                      ? "bg-[#F4F1E8] shadow-[inset_3px_0_0_var(--color-tinta)]"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] font-semibold tracking-[-0.02em]">
                      {pedidos[0]?.ref_externa ??
                        p.envios?.ref_externa ??
                        "sem código"}
                    </span>
                    <span className="mt-[1px] block truncate text-[11px] text-suave">
                      {p.contas?.apelido ?? "—"}
                      {pedidos.length > 1 && ` · pack ${pedidos.length}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12.5px] font-semibold text-suave">
                    {p.unidades_esperadas ?? "—"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selecionado ? (
          <Detalhe
            pacote={selecionado}
            fila={fila}
            etapa={etapa}
            liberacao={liberacao}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 py-20">
            <p className="max-w-[44ch] text-center text-[14px] leading-relaxed text-suave">
              Este pacote não está mais nesta etapa. Volte para a lista.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

async function Detalhe({
  pacote,
  fila,
  etapa,
  liberacao,
}: {
  pacote: PacoteNaFila;
  fila: PacoteNaFila[];
  etapa: Etapa;
  liberacao?: string;
}) {
  const supabase = await criarClienteServidor();
  const pedidos = pacote.envios?.pedidos ?? [];
  const turno = await turnoDaMaquina();

  const [{ data: conferencias }, { data: eventos }] = await Promise.all([
    supabase
      .from("conferencias")
      .select("id")
      .eq("pacote_id", pacote.id)
      .eq("situacao", "em_andamento")
      .limit(1),
    supabase
      .from("eventos_pacote")
      .select("tipo, de, para, detalhe, em")
      .eq("pacote_id", pacote.id)
      .order("em", { ascending: false })
      .limit(12),
  ]);

  const conferencia = conferencias?.[0];
  const proximo = fila.find((p) => p.id !== pacote.id)?.id ?? null;

  // Divergência aberta e quem pode liberar. Buscados juntos: a bancada precisa
  // dos dois ao mesmo tempo ou de nenhum.
  let divergencia: DivergenciaAberta | null = null;
  let jaLiberada = false;
  let lideres: Lider[] = [];

  if (conferencia) {
    const [{ data: divs }, { data: chefes }] = await Promise.all([
      supabase
        .from("divergencias")
        .select("id, tipo, detalhe, aberta_em, liberada_em")
        .eq("conferencia_id", conferencia.id)
        .order("aberta_em"),
      supabase
        .from("operadores")
        .select("id, nome")
        .eq("papel", "lider")
        .eq("ativo", true)
        .not("pin_hash", "is", null)
        .order("nome"),
    ]);
    const todas = (divs ?? []) as (DivergenciaAberta & {
      liberada_em: string | null;
    })[];
    divergencia = todas.find((d) => d.liberada_em === null) ?? null;
    // Uma divergência já liberada é a autorização para fechar com diferença.
    jaLiberada = todas.some((d) => d.liberada_em !== null);
    lideres = (chefes ?? []) as Lider[];
  }

  let itens: ItemConferido[] = [];
  if (conferencia) {
    const { data } = await supabase
      .from("conferencia_itens")
      .select(
        "sku_id, quantidade_esperada, quantidade_lida, skus ( codigo, descricao )",
      )
      .eq("conferencia_id", conferencia.id);

    itens = ((data ?? []) as unknown as RawItem[]).map((i) => ({
      sku_id: i.sku_id,
      codigo: i.skus?.codigo ?? "—",
      descricao: i.skus?.descricao ?? "Produto sem descrição",
      quantidade_esperada: i.quantidade_esperada,
      quantidade_lida: i.quantidade_lida,
      eh_kit: false,
    }));
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 px-6 pt-5">
        <h1 className="m-0 text-[21px] font-bold tracking-[-0.025em]">
          <span className="font-mono font-semibold">
            {pedidos[0]?.ref_externa ?? pacote.envios?.ref_externa}
          </span>
        </h1>
        {pedidos.length > 1 && (
          <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
            pack · {pedidos.length} pedidos · 1 etiqueta
          </span>
        )}
        <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
          {rotuloEtapa(pacote.etapa)}
        </span>
      </header>

      <dl className="grid grid-cols-[auto_1fr_auto_1fr] items-baseline gap-x-[14px] gap-y-[7px] px-6 py-4 text-[13px]">
        <dt className="font-medium text-suave">Conta</dt>
        <dd className="m-0 font-semibold">{pacote.contas?.apelido ?? "—"}</dd>
        <dt className="font-medium text-suave">Modalidade</dt>
        <dd className="m-0 font-semibold">
          {pacote.envios?.modalidades?.nome ?? "não classificada"}
        </dd>
        <dt className="font-medium text-suave">Empresa emissora</dt>
        <dd className="m-0 font-semibold">
          {pacote.contas?.empresas?.nome_curto ?? "—"}
        </dd>
        <dt className="font-medium text-suave">Data limite</dt>
        <dd className="m-0 font-semibold">
          {pacote.envios?.limite_envio_em
            ? new Date(pacote.envios.limite_envio_em).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              })
            : "sem prazo do canal"}
        </dd>
        <dt className="font-medium text-suave">Etiqueta</dt>
        <dd className="m-0 font-semibold">
          {pacote.envios?.etiqueta_obtida_em ? "obtida do canal" : "pendente"}
        </dd>
        <dt className="font-medium text-suave">Unidades</dt>
        <dd className="m-0 font-semibold">
          {pacote.unidades_esperadas ?? "—"}
        </dd>
      </dl>

      {etapa === "conferir" ? (
        conferencia ? (
          <Bancada
            conferenciaId={conferencia.id}
            itensIniciais={itens}
            proximoPacote={proximo}
            pacoteId={pacote.id}
            divergencia={divergencia}
            jaLiberada={jaLiberada}
            operadorId={turno?.operadorId ?? null}
            lideres={lideres}
            liberacao={liberacao}
          />
        ) : (
          <IniciarBancada pacoteId={pacote.id} />
        )
      ) : (
        <Historico eventos={(eventos ?? []) as Evento[]} />
      )}
    </>
  );
}

type Evento = {
  tipo: string;
  de: string | null;
  para: string | null;
  detalhe: string | null;
  em: string;
};

type RawItem = {
  sku_id: string;
  quantidade_esperada: number;
  quantidade_lida: number;
  skus: { codigo: string; descricao: string } | null;
};

function Historico({ eventos }: { eventos: Evento[] }) {
  return (
    <section className="border-t border-linha px-6 py-4">
      <h2 className="m-0 mb-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        Histórico
      </h2>
      {eventos.length === 0 ? (
        <p className="text-[13px] text-suave">
          Nenhum evento ainda. Cada mudança de etapa, leitura e impressão vira
          uma linha aqui.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {eventos.map((e, i) => (
            <li
              key={i}
              className="flex gap-3 border-b border-linha-suave py-[9px] last:border-b-0"
            >
              <span className="w-[112px] shrink-0 font-mono text-[11.5px] text-suave">
                {new Date(e.em).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "America/Sao_Paulo",
                })}
              </span>
              <span className="text-[13px]">
                {e.tipo === "etapa" ? (
                  <>
                    <b className="font-semibold">{rotuloEtapa(e.para ?? "")}</b>
                    {e.de && (
                      <span className="text-suave"> · veio de {rotuloEtapa(e.de)}</span>
                    )}
                  </>
                ) : (
                  <>
                    <b className="font-semibold">{e.tipo}</b>
                    {e.detalhe && (
                      <span className="text-suave"> · {e.detalhe}</span>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function IniciarBancada({ pacoteId }: { pacoteId: string }) {
  async function abrir() {
    "use server";
    await iniciarConferencia(pacoteId);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="max-w-[48ch] text-[14px] leading-relaxed text-suave">
        Abrir a conferência congela o que tem que estar na caixa, já expandindo
        kit. O catálogo pode mudar no meio do turno, mas a caixa que o operador
        tem na mão é a de agora.
      </p>
      <form action={abrir}>
        <button
          type="submit"
          className="rounded-[10px] bg-tinta px-[22px] py-[13px] text-[15px] font-semibold text-white"
        >
          Abrir a bancada
        </button>
      </form>
    </div>
  );
}

function rotuloEtapa(e: string) {
  const mapa: Record<string, string> = {
    aberto: "Aberto",
    faturado: "Faturado",
    separar: "Separar",
    conferir: "Conferir",
    pronto: "Pronto pra envio",
    retido: "Retido",
    encerrado: "Encerrado",
  };
  return mapa[e] ?? e;
}
