import { redirect } from "next/navigation";
import Link from "next/link";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";
import {
  ABAS_EXPEDICAO,
  ehVista,
  type Etapa,
  type LinhaPacote,
  type Vista,
} from "@/lib/supabase/tipos";
import { Barra } from "@/components/barra";
import { ListaPacotes } from "./lista";
import { AbrirCarrinho } from "../logistica/abrir-carrinho";
import { PainelDetalhe } from "./conferencia/painel";
import { PainelListas } from "./listas/painel";
import { AbertoPorCausa } from "./aberto";

export const metadata = { title: "Expedição — ZYNTRA" };

const SELECAO = `
  id, etapa, etapa_desde, unidades_esperadas,
  envios ( ref_externa, limite_envio_em, etiqueta_obtida_em,
           modalidades ( nome, gera_etiqueta ),
           pedidos ( ref_externa, pack_ref, comprador ) ),
  contas ( apelido,
           empresas:empresa_emissora_id ( nome_curto ),
           canais ( nome, icone_url, sigla, cor, cor_texto ) ),
  notas_fiscais ( situacao, serie, numero, erro_mensagem ),
  bloqueios ( tipo, causa )
`;

export default async function PaginaExpedicao({
  searchParams,
}: {
  searchParams: Promise<{
    etapa?: string;
    pacote?: string;
    lista?: string;
    falha?: string;
    impressao?: string;
    liberacao?: string;
    etiqueta?: string;
    reprocesso?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/expedicao");

  const {
    etapa: pedida,
    pacote,
    lista,
    falha,
    impressao,
    liberacao,
    etiqueta,
    reprocesso,
  } = await searchParams;
  const vista: Vista = pedida && ehVista(pedida) ? pedida : "separar";
  // "listas" não é etapa: a consulta de pacotes continua olhando Separar.
  const etapaAtiva: Etapa = vista === "listas" ? "separar" : vista;

  // Contagem por etapa numa consulta só, em vez de uma por aba.
  const { data: contagens } = await supabase
    .from("pacotes")
    .select("etapa")
    .neq("etapa", "encerrado");

  const porEtapa = new Map<string, number>();
  for (const linha of contagens ?? []) {
    porEtapa.set(linha.etapa, (porEtapa.get(linha.etapa) ?? 0) + 1);
  }

  const { count: listasAbertas } = await supabase
    .from("listas_separacao")
    .select("id", { count: "exact", head: true })
    .in("situacao", ["aguardando", "em_execucao"]);

  const { data: pacotes, error } = await supabase
    .from("pacotes")
    .select(SELECAO)
    .eq("etapa", etapaAtiva)
    .order("etapa_desde", { ascending: true })
    .limit(200);

  return (
    <Casca
      frente="expedicao"
      email={user.email ?? "sem e-mail"}
      compacta={vista === "conferir" && Boolean(pacote)}
    >
      <Barra
        rotulo="Etapas da esteira"
        abas={[
          ...ABAS_EXPEDICAO.map((a) => ({
            chave: a.etapa,
            href: `/expedicao?etapa=${a.etapa}`,
            rotulo: a.rotulo,
            contagem: porEtapa.get(a.etapa) ?? 0,
            ativa: vista === a.etapa,
            // Cor só onde ela significa "olhe aqui": pedido parado em Aberto
            // e nota pendente em Faturado. O resto é contagem.
            tom:
              a.etapa === "aberto"
                ? ("critico" as const)
                : a.etapa === "faturado"
                  ? ("atencao" as const)
                  : undefined,
          })),
          {
            chave: "listas",
            href: "/expedicao?etapa=listas",
            rotulo: "Lista de separação",
            contagem: listasAbertas ?? 0,
            ativa: vista === "listas",
            // Fora da esteira: a esteira é ABERTO > FATURADO > SEPARAR >
            // CONFERIR > PRONTO, e só. Um pacote nunca está "em listas" — ele
            // está em Separar e por acaso pertence a uma lista. Deixá-la no
            // meio da sequência fazia a esteira parecer ter seis etapas.
            separadaAntes: true,
          },
          {
            chave: "retido",
            href: "/expedicao?etapa=retido",
            rotulo: "Retidos",
            contagem: porEtapa.get("retido") ?? 0,
            ativa: vista === "retido",
            tom: "atencao" as const,
            // Também fora da esteira, junto da Lista: são as duas coisas que
            // não são etapa.
          },
        ]}
        explicacao={
          <>
            <Explicacao vista={vista} />
            {falha && (
              <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] font-semibold text-critico">
                {falha === "todos_ja_em_lista"
                  ? "Esses pacotes já estão numa lista ativa."
                  : falha === "pacote_fora_de_separar"
                    ? "Só pacote em Separar entra em lista."
                    : "Não foi possível gerar a lista."}
              </span>
            )}
          </>
        }
        rodapeDireita={
          <span>
            <b className="font-semibold text-tinta">{pacotes?.length ?? 0}</b>{" "}
            {(pacotes?.length ?? 0) === 1 ? "pacote" : "pacotes"}
          </span>
        }
      />

      <div className="flex flex-1 flex-col bg-superficie">
        {vista === "listas" ? (
          <PainelListas listaId={lista} impressao={impressao} />
        ) : vista === "aberto" && !pacote ? (
          <AbertoPorCausa resultado={reprocesso} />
        ) : pacote ? (
          <PainelDetalhe
            fila={(pacotes ?? []) as never[]}
            pacoteId={pacote}
            etapa={etapaAtiva}
            liberacao={liberacao}
            etiqueta={etiqueta}
          />
        ) : error ? (
          <Vazio
            titulo="Não foi possível ler a esteira"
            texto={error.message}
            critico
          />
        ) : !pacotes || pacotes.length === 0 ? (
          <Vazio {...vazioDaEtapa(etapaAtiva)} />
        ) : (
          <div className="flex flex-1 flex-col">
            <ListaPacotes
              pacotes={pacotes as unknown as LinhaPacote[]}
              etapa={etapaAtiva}
              selecionavel={vista === "separar"}
            />
            {/* O fechamento mora aqui: quando a caixa está pronta pra envio, o
                passo seguinte é levá-la para a doca. Mandar a pessoa trocar de
                frente para achar o botão é pedir que ela largue a pilha. */}
            {vista === "pronto" && (
              <div className="mt-auto border-t border-linha bg-fundo px-5 py-3">
                <AbrirCarrinho
                  compacto
                  aviso="Abre o carrinho e leva para a bancada de bipagem da doca. Caixa sem etiqueta confirmada é recusada lá."
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Casca>
  );
}



function Explicacao({ vista }: { vista: Vista }) {
  const texto: Partial<Record<Vista, string>> = {
    listas:
      "A lista do corredor, consolidada por SKU. Pode cruzar contas e empresas.",
    aberto:
      "Só faturamento e SKU — o que a gente resolve no cadastro e reprocessa.",
    faturado:
      "Nota autorizada, esperando a etiqueta do canal. Não há o que corrigir aqui.",
    separar: "Nota e etiqueta prontas. É daqui que saem as listas.",
    conferir: "Separado, esperando a bipagem na bancada.",
    pronto: "Conferido e lacrado, esperando a entrega na doca.",
    retido:
      "Fora da esteira: cancelamento, endereço trocado, modalidade alterada pelo canal.",
  };
  return <span>{texto[vista]}</span>;
}

function vazioDaEtapa(etapa: Etapa) {
  if (etapa === "aberto") {
    return {
      titulo: "Nada parado",
      texto:
        "Em operação normal esta aba fica vazia. Se encher, o problema é de cadastro ou de configuração — não de volume.",
    };
  }
  if (etapa === "retido") {
    return {
      titulo: "Nenhum pedido retido",
      texto:
        "Aqui aparece o que não depende de cadastro nosso. Quando resolver, o pedido volta para a etapa de onde saiu.",
    };
  }
  return {
    titulo: "Nenhuma conta conectada",
    texto:
      "A esteira fica vazia até a primeira conta do Mercado Livre ser ligada na Integração. Nada aqui é dado de exemplo.",
  };
}

function Vazio({
  titulo,
  texto,
  critico,
}: {
  titulo: string;
  texto: string;
  critico?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-20">
      <div className="max-w-[52ch] text-center">
        <h2
          className={`text-[20px] font-bold tracking-[-0.02em] ${critico ? "text-critico" : ""}`}
        >
          {titulo}
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-suave">{texto}</p>
      </div>
    </div>
  );
}
