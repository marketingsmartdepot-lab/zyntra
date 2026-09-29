import Link from "next/link";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { Etapa } from "@/lib/supabase/tipos";
import { Bancada, type ItemConferido } from "./bancada";
import { iniciarConferencia } from "./acoes";
import type { DivergenciaAberta, Lider } from "./divergencia";
import { BlocoDoPedido } from "./itens";
import { FilaDePacotes, type PacoteNaFila } from "./fila";
import { modoBipagemLigado } from "../bipagem-acoes";
import { permissoesDeAgora } from "@/lib/permissoes";
import { Anexos } from "./anexos";
import {
  PainelEtiqueta,
  type ImpressaoDaEtiqueta,
} from "./etiqueta-painel";


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
  etiqueta,
  aba,
}: {
  fila: PacoteNaFila[];
  pacoteId: string;
  etapa: Etapa;
  liberacao?: string;
  etiqueta?: string;
  /** Qual aba do pedido está aberta. O histórico é uma delas, não um rodapé. */
  aba?: string;
}) {
  const selecionado = fila.find((p) => p.id === pacoteId) ?? null;

  return (
    <div className="flex flex-1">
      <FilaDePacotes fila={fila} etapa={etapa} selecionado={pacoteId} />

      <section className="flex min-w-0 flex-1 flex-col">
        {selecionado ? (
          <Detalhe
            pacote={selecionado}
            fila={fila}
            etapa={etapa}
            liberacao={liberacao}
            etiqueta={etiqueta}
            aba={
              aba === "timeline" ? "timeline" : aba === "anexos" ? "anexos" : "geral"
            }
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
  etiqueta,
  aba,
}: {
  pacote: PacoteNaFila;
  fila: PacoteNaFila[];
  etapa: Etapa;
  liberacao?: string;
  etiqueta?: string;
  aba: "geral" | "anexos" | "timeline";
}) {
  const supabase = await criarClienteServidor();
  const pedidos = pacote.envios?.pedidos ?? [];

  // O histórico de impressão da etiqueta decide o que a tela oferece:
  // imprimir, ou reimprimir exigindo motivo.
  const { data: impressoesEtiqueta } = await supabase
    .from("impressoes")
    .select(
      "situacao, erro, enviada_em, reimpressao, confirmada_em, confirmada_codigo",
    )
    .eq("pacote_id", pacote.id)
    .eq("tipo", "etiqueta")
    .order("enviada_em", { ascending: false });

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

  // A etiqueta em PDF existe? É ela que a bancada sem impressora abre na tela.
  const { data: comPdf } = await supabase
    .from("pacotes")
    .select("envios ( etiqueta_pdf )")
    .eq("id", pacote.id)
    .maybeSingle();
  const temEtiquetaPdf =
    ((comPdf as unknown as { envios: { etiqueta_pdf: string | null } | null } | null)
      ?.envios?.etiqueta_pdf ?? null) !== null;

  // Quem está LOGADO pode zerar a conferência? A tela esconde o botão, mas
  // quem decide é o banco — esconder não impede de chamar.
  const podeReiniciar = (await permissoesDeAgora()).has("reiniciar_conferencia");
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

  const abas = [
    { chave: "geral", rotulo: "Geral" },
    { chave: "anexos", rotulo: "Anexos" },
    { chave: "timeline", rotulo: "Timeline" },
  ] as const;

  const enderecoDaAba = (chave: string) =>
    `/expedicao?etapa=${etapa}&pacote=${pacote.id}` +
    (chave === "geral" ? "" : `&aba=${chave}`);

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

        <span className="flex-1" />

        {/* Fechar mora onde a mão procura: no canto do que está aberto. O
            "Ver lista inteira" da barra lateral continua valendo, mas ninguém
            olha para o outro lado da tela para sair de onde está. */}
        <Link
          href={`/expedicao?etapa=${etapa}`}
          aria-label="Fechar o pedido e voltar para a lista"
          title="Fechar"
          className="-mr-1 flex h-8 w-8 items-center justify-center rounded-lg border border-linha text-suave no-underline hover:bg-fundo"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* As abas do pedido. O histórico é uma delas, e não um rodapé: embaixo
          da tabela ele empurrava para fora da tela justamente o que a bancada
          precisa ver. */}
      <nav className="mt-4 flex gap-1 border-b border-linha px-6">
        {abas.map((a) => {
          const ativa = a.chave === aba;
          return (
            <Link
              key={a.chave}
              href={enderecoDaAba(a.chave)}
              aria-current={ativa ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-[9px] text-[13.5px] font-semibold no-underline ${
                ativa
                  ? "border-tinta text-tinta"
                  : "border-transparent text-suave"
              }`}
            >
              {a.rotulo}
            </Link>
          );
        })}
      </nav>

      {aba === "timeline" ? (
        <Historico eventos={(eventos ?? []) as Evento[]} />
      ) : aba === "anexos" ? (
        <Anexos pacoteId={pacote.id} />
      ) : (
        <>
          <div className="pt-5" />
          <BlocoDoPedido
            pacoteId={pacote.id}
            conferenciaId={conferencia?.id ?? null}
          />

          {etapa === "pronto" && (
            <PainelEtiqueta
              pacoteId={pacote.id}
              impressoes={(impressoesEtiqueta ?? []) as ImpressaoDaEtiqueta[]}
              resultado={etiqueta}
            />
          )}

          {etapa === "conferir" ? (
            conferencia ? (
              <Bancada
                conferenciaId={conferencia.id}
                itensIniciais={itens}
                proximoPacote={proximo}
                pacoteId={pacote.id}
                divergencia={divergencia}
                jaLiberada={jaLiberada}
                  podeReiniciar={podeReiniciar}
                temEtiquetaPdf={temEtiquetaPdf}
                lideres={lideres}
                liberacao={liberacao}
                modoBipagem={await modoBipagemLigado()}
              />
            ) : (
              <IniciarBancada pacoteId={pacote.id} />
            )
          ) : (
            <BiparAindaNao etapa={etapa} />
          )}
        </>
      )}
    </>
  );
}

/**
 * O campo de bipagem nas etapas em que a conferência ainda não abriu.
 *
 * Ele aparece, porque é onde a pessoa espera encontrá-lo, mas não aceita
 * leitura. Bipar antes da nota autorizada permitiria fechar a caixa e imprimir
 * sem nota — exatamente o que a esteira existe para impedir. Some o campo, e
 * ela procura; deixe-o funcionar, e a regra vira decoração. Então ele fica, e
 * diz o que falta.
 */
function BiparAindaNao({ etapa }: { etapa: Etapa }) {
  const motivo: Partial<Record<Etapa, string>> = {
    aberto: "A conferência abre quando a nota estiver autorizada.",
    faturado: "A conferência abre quando o pedido chegar em Separar e a lista sair.",
    separar: "A conferência abre ao gerar a lista de separação.",
    pronto: "Esta caixa já foi conferida e lacrada.",
    retido: "Pedido retido não é conferido enquanto o problema não se resolver.",
  };

  return (
    <div className="mx-6 mt-5 mb-6 flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-linha px-4 py-[14px]">
      <input
        disabled
        placeholder="Conferência: insira o EAN ou bipe o produto"
        aria-label="Conferência"
        className="min-w-[280px] flex-1 rounded-lg border border-linha bg-fundo px-3 py-[10px] text-[13.5px] text-suave"
      />
      <span className="text-[12.5px] text-suave">
        {motivo[etapa] ?? "A conferência acontece na aba Conferir."}
      </span>
    </div>
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
    enviado: "Enviado",
  };
  return mapa[e] ?? e;
}
