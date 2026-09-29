import { permissoesDeAgora } from "@/lib/permissoes";
import { noAparelho } from "@/lib/operador";
import { QuemEVoce } from "@/components/quem-e-voce";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { Barra, Indicador } from "@/components/barra";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Doca, type EntregaResumo } from "./doca";
import {
  EstacaoDeSaida,
  type ModalidadeDeSaida,
  type SaidaResumo,
} from "./saida";
import { Fechamento } from "./fechamento";
import { BancadaDeSaida } from "./bancada";
import { turnoDaMaquina } from "@/lib/estacao";

export const metadata = { title: "Logística — ZYNTRA" };

const ABAS = [
  { chave: "doca", rotulo: "Doca" },
  { chave: "saida", rotulo: "Estação de saída" },
  { chave: "fechamento", rotulo: "Fechamento" },
] as const;

type Aba = (typeof ABAS)[number]["chave"];

export default async function PaginaLogistica({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string;
    saida?: string;
    entrega?: string;
    bipar?: string;
    falha?: string;
    fechada?: string;
    levados?: string;
    recusados?: string;
    quem?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();

  // Fechamento é uma aba de dinheiro e nada mais — é o custo do Flex no mês.
  // Sem "Valores e custos" ela nem aparece na faixa: aba que abre e diz "não
  // pode" é pior que aba que não existe.
  const veValores = (await permissoesDeAgora()).has("ver_valores");

  // Quem está no computador da porta, identificado por PIN. O bipe da saída
  // fica no nome dessa pessoa — antes dependia de um turno de bancada que
  // ninguém abria, e o bipe nascia sem dono.
  const naPorta = await noAparelho();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/logistica");

  const {
    aba: pedida,
    saida: saidaId,
    entrega: entregaId,
    bipar,
    falha,
    fechada,
    levados,
    recusados,
    quem,
  } = await searchParams;
  // Fechamento pedido por quem não enxerga valores cai na Doca, não numa tela
  // branca: quem chegou por um link antigo precisa de um lugar para ficar.
  const pediu = ABAS.some((a) => a.chave === pedida) ? (pedida as Aba) : "doca";
  const aba: Aba = pediu === "fechamento" && !veValores ? "doca" : pediu;

  const [{ data: destinos }, { data: saidas }, { data: entregas }] =
    await Promise.all([
      supabase.from("doca_por_destino").select("*").order("modalidade"),
      supabase
        .from("saidas_resumo")
        .select("*")
        .order("aberta_em", { ascending: false })
        .limit(50),
      supabase
        .from("entregas_doca_resumo")
        .select("*")
        .order("entregue_em", { ascending: false })
        .limit(20),
    ]);

  const naDoca = (destinos ?? []).reduce(
    (t: number, d: { pacotes: number }) => t + d.pacotes,
    0,
  );
  const abertas = (saidas ?? []).filter(
    (s: { situacao: string }) => s.situacao === "em_andamento",
  );

  // A bancada só abre para uma saída que ainda aceita bipe. Uma já fechada
  // volta para a lista em vez de mostrar um leitor que não registra nada.
  const turno = await turnoDaMaquina();

  // O acumulado do mês fica visível em toda aba da Logística: é o número que
  // vira dinheiro no fim do mês, e antes só aparecia se alguém clicasse em
  // Fechamento.
  const primeiroDia = new Date();
  primeiroDia.setDate(1);
  const { data: doMes } = await supabase
    .from("fechamento_custo_etiqueta")
    .select("total")
    .gte("dia", primeiroDia.toISOString().slice(0, 10));

  // Os destinos para abrir saída. A contagem da doca vem junto porque escolher
  // um destino vazio é escolher errado, e a tela deve dizer isso na hora.
  const { data: modalidades } = await supabase
    .from("modalidades")
    .select("id, nome")
    .eq("entra_na_esteira", true)
    .order("nome");

  const naDocaPorModalidade = new Map<string, number>();
  for (const d of (destinos ?? []) as { modalidade_id: string | null; pacotes: number }[]) {
    if (d.modalidade_id) naDocaPorModalidade.set(d.modalidade_id, d.pacotes);
  }

  const abertasPorModalidade = new Set(
    ((saidas ?? []) as SaidaResumo[])
      .filter((s) => s.situacao === "em_andamento")
      .map((s) => s.modalidade),
  );

  const modalidadesDeSaida: ModalidadeDeSaida[] = (
    (modalidades ?? []) as { id: string; nome: string }[]
  ).map((m) => ({
    id: m.id,
    nome: m.nome,
    na_doca: naDocaPorModalidade.get(m.id) ?? 0,
    ja_aberta: abertasPorModalidade.has(m.nome),
  }));

  const acumulado = ((doMes ?? []) as { total: number | string }[]).reduce(
    (t, l) => t + Number(l.total),
    0,
  );

  const naBancada =
    bipar === "1" && saidaId
      ? ((abertas as SaidaResumo[]).find((s) => s.id === saidaId) ?? null)
      : null;

  return (
    <Casca frente="logistica" email={user.email ?? "sem e-mail"}>
      <Barra
        rotulo="Seções da logística"
        abas={[
          {
            chave: "doca",
            href: "/logistica?aba=doca",
            rotulo: "Doca",
            contagem: naDoca,
            ativa: aba === "doca",
          },
          {
            chave: "saida",
            href: "/logistica?aba=saida",
            rotulo: "Estação de saída",
            contagem: abertas.length,
            ativa: aba === "saida",
          },
          ...(veValores
            ? [
                {
                  chave: "fechamento",
                  href: "/logistica?aba=fechamento",
                  rotulo: "Fechamento",
                  // Fechamento não conta pacote: conta mês.
                  legenda: mesAtual().toLowerCase(),
                  ativa: aba === "fechamento",
                  separadaAntes: true,
                },
              ]
            : []),
        ]}
        direita={
          <Indicador
            rotulo={`Flex em ${mesAtual().toLowerCase()}`}
            valor={acumulado.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          />
        }
        explicacao={
          <>
            {aba === "doca" &&
              "Os carrinhos que chegaram da Expedição. Aqui ninguém bipa: o carrinho é a lista de separação e se enche sozinho ao finalizar cada conferência. O bipe é na Estação de saída."}
            {aba === "saida" &&
              "A segunda bipagem: contra a relação que sai pela porta, não contra o que o cliente comprou."}
            {aba === "fechamento" &&
              "Soma dos valores congelados no instante do bipe. Só o Flex tem custo."}
          </>
        }
      />

      {(levados !== undefined || recusados) && (
        <Levados levados={levados} recusados={recusados} />
      )}

      {falha && (
        <p className="shrink-0 border-b border-critico-linha bg-critico-bg px-5 py-[10px] text-[12.5px] font-semibold text-critico">
          {falha === "saida_vazia"
            ? "Nada foi bipado nesta saída, então não há o que fechar."
            : falha === "saida_nao_aberta"
              ? "Esta saída já estava fechada."
              : falha === "modalidade_nao_encontrada"
                ? "Este destino não existe mais."
                : falha === "sem_nome"
                  ? "Escreva o nome de quem está levando o carrinho."
                  : "Não foi possível concluir a operação."}
        </p>
      )}

      {fechada && (
        <p className="shrink-0 border-b border-ok-linha bg-ok-bg px-5 py-[10px] text-[12.5px] font-semibold text-ok">
          Saída fechada. O valor acumulado entra no fechamento do mês.
        </p>
      )}

      <div className="flex-1 bg-superficie">
        {/* Na doca ninguém bipa. O carrinho se enche sozinho ao finalizar a
            conferência, e o único bipe do fluxo é na Estação de saída, quando
            a caixa vai da doca para o caminhão. */}
        {aba === "doca" && (
          <Doca
            destinos={destinos ?? []}
            entregas={(entregas ?? []) as EntregaResumo[]}
            veValores={veValores}
          />
        )}
        {aba === "saida" &&
          (naBancada ? (
            naPorta ? (
            <BancadaDeSaida
              saidaId={naBancada.id}
              codigo={naBancada.codigo}
              modalidade={naBancada.modalidade}
              jaBipados={naBancada.pacotes}
              totalInicial={Number(naBancada.total)}
              aindaNaDoca={naBancada.na_doca}
              operadorId={naPorta.id}
              veValores={veValores}
            />
            ) : (
              /* Sem saber quem bipou, a minuta e o custo do Flex ficariam sem
                 dono — e é justamente a conta que fecha o mês. */
              <QuemEVoce
                voltar={`/logistica?aba=saida&saida=${naBancada.id}&bipar=1`}
                titulo="Estação de saída"
                aviso={quem}
              />
            )
          ) : (
            <EstacaoDeSaida
              saidas={saidas ?? []}
              modalidades={modalidadesDeSaida}
              veValores={veValores}
            />
          ))}
        {aba === "fechamento" && <Fechamento />}
      </div>
    </Casca>
  );
}

function mesAtual() {
  const m = new Date().toLocaleDateString("pt-BR", {
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/**
 * O resultado de levar caixas marcadas para a doca.
 *
 * Existe porque eu tinha escrito o resultado no endereço e esquecido de
 * mostrá-lo: ela marcava as caixas, clicava, e caía numa tela de bipe com o
 * carrinho vazio, sem uma palavra sobre o que tinha acontecido.
 *
 * Recusa nomeia a caixa. Um número sozinho faria alguém empurrar o carrinho
 * achando que levou tudo.
 */
function Levados({
  levados,
  recusados,
}: {
  levados?: string;
  recusados?: string;
}) {
  const n = Number(levados ?? 0) || 0;

  const lista = (() => {
    if (!recusados) return [] as { codigo: string; motivo: string }[];
    try {
      return JSON.parse(recusados) as { codigo: string; motivo: string }[];
    } catch {
      return [];
    }
  })();

  if (n === 0 && lista.length === 0) return null;

  return (
    <div
      className={`shrink-0 border-b px-5 py-[10px] text-[12.5px] ${
        lista.length === 0
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-atencao-linha bg-atencao-bg text-atencao"
      }`}
    >
      <b className="font-semibold">
        {n === 0
          ? "Nenhuma caixa entrou no carrinho."
          : `${n} ${n === 1 ? "caixa entrou" : "caixas entraram"} no carrinho.`}
      </b>

      {lista.length > 0 && (
        <ul className="m-0 mt-1 list-none p-0">
          {lista.map((r) => (
            <li key={r.codigo}>
              <span className="font-mono font-semibold">{r.codigo}</span> —{" "}
              {r.motivo}
            </li>
          ))}
        </ul>
      )}

      {lista.some((r) => r.motivo.includes("etiqueta")) && (
        <p className="m-0 mt-[6px] leading-snug">
          A etiqueta é confirmada bipando o papel na bancada, e quem confirma é
          o agente de impressão — que só roda no Windows. Nesta máquina nenhuma
          caixa vai passar por aqui.
        </p>
      )}
    </div>
  );
}
