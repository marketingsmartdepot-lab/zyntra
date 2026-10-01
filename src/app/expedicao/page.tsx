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
import { permissoesDeAgora } from "@/lib/permissoes";
import { ChamarModoBipagem } from "./modo-bipagem";
import { EsperandoBipe } from "./conferencia/esperando-bipe";
import { modoBipagemLigado } from "./bipagem-acoes";
import { PainelDetalhe } from "./conferencia/painel";
import { PainelListas } from "./listas/painel";
import { AbertoPorCausa } from "./aberto";
import type { ValorDeFiltro } from "./filtro-coluna";

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
    feito?: string;
    quantos?: string;
    recusados?: string;
    pacote?: string;
    lista?: string;
    falha?: string;
    impressao?: string;
    liberacao?: string;
    impressao_etiqueta?: string;
    reprocesso?: string;
    aba?: string;
    conta?: string;
    modalidade?: string;
    nf?: string;
    etiqueta?: string;
    separacao?: string;
    bipe?: string;
    codigo?: string;
    bipagem?: string;
  }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/expedicao");

  // O que esta pessoa pode fazer na esteira. A Casca já barra quem não enxerga
  // a Expedição; aqui é o nível de dentro, que decide quais botões existem.
  const pode = await permissoesDeAgora();

  const {
    etapa: pedida,
    pacote,
    lista,
    falha,
    impressao,
    liberacao,
    impressao_etiqueta: impressaoEtiqueta,
    bipe,
    codigo: codigoBipado,
    bipagem,
    reprocesso,
    feito,
    quantos,
    recusados,
    aba,
    conta,
    modalidade,
    nf,
    etiqueta,
    separacao,
  } = await searchParams;
  const vista: Vista = pedida && ehVista(pedida) ? pedida : "separar";
  // "listas" não é etapa: a consulta de pacotes continua olhando Separar.
  const etapaAtiva: Etapa = vista === "listas" ? "separar" : vista;

  // Contagem por etapa numa consulta só, em vez de uma por aba. Enviado entra
  // na conta: a aba existe para mostrar o que já saiu, e excluir seria contar
  // zero numa aba cheia.
  const { data: contagens } = await supabase.from("pacotes").select("etapa");

  const porEtapa = new Map<string, number>();
  for (const linha of contagens ?? []) {
    porEtapa.set(linha.etapa, (porEtapa.get(linha.etapa) ?? 0) + 1);
  }

  // Lista não tem mais "aberta": ela nasce emitida e os pedidos já andaram.
  // O número que interessa na aba é quantas saíram hoje.
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const { count: listasDoDia } = await supabase
    .from("listas_separacao")
    .select("id", { count: "exact", head: true })
    .gte("criada_em", inicioDoDia.toISOString());

  // Quem escolhe QUAIS pacotes é o banco, com os filtros; a consulta abaixo só
  // busca os detalhes dos escolhidos. Filtrar depois de carregar funcionaria
  // enquanto coubesse tudo na memória — e o dia em que não coubesse, pedidos
  // sumiriam sem ninguém entender por quê.
  // Vários valores por coluna: o time separa Flex e Agência no mesmo carrinho,
  // e um seletor de valor único obrigaria a duas passagens.
  const valoresDe = (v?: string) =>
    (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const { data: escolhidos } = await supabase.rpc("pacotes_filtrados", {
    p_etapa: etapaAtiva,
    p_busca: null,
    p_contas: valoresDe(conta),
    p_modalidades: valoresDe(modalidade),
    p_nf: valoresDe(nf),
    p_etiqueta: valoresDe(etiqueta),
    p_listas: valoresDe(separacao),
    p_limite: 200,
  });

  const ids = ((escolhidos ?? []) as { id: string }[]).map((x) => x.id);

  // De qual lista de separação é cada caixa. Consulta à parte, e não embutida
  // na de cima, porque a ligação passa por uma tabela de junção — e um erro de
  // embutimento aqui derrubaria a esteira inteira, não só a coluna nova.
  const { data: vinculosDeLista } =
    ids.length === 0
      ? { data: [] }
      : await supabase
          .from("listas_pacotes")
          .select("pacote_id, listas_separacao ( codigo, operadores ( nome ) )")
          .in("pacote_id", ids)
          .eq("ativa", true);

  const listaDoPacote = new Map<string, { codigo: string; separador: string | null }>();
  for (const v of (vinculosDeLista ?? []) as unknown as {
    pacote_id: string;
    listas_separacao: { codigo: string; operadores: { nome: string } | null } | null;
  }[]) {
    if (v.listas_separacao) {
      listaDoPacote.set(v.pacote_id, {
        codigo: v.listas_separacao.codigo,
        separador: v.listas_separacao.operadores?.nome ?? null,
      });
    }
  }

  const { data: pacotes, error } =
    ids.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("pacotes")
          .select(SELECAO)
          .in("id", ids)
          .order("etapa_desde", { ascending: true });

  // Os valores que o filtro oferece são os que existem nesta etapa. Oferecer
  // uma conta sem nenhum pedido aqui é dar uma opção que não muda nada.
  const { data: valoresDeFiltro } = await supabase.rpc("valores_para_filtro", {
    p_etapa: etapaAtiva,
  });

  const filtrosAtivos = {
    etapa: vista,
    conta,
    modalidade,
    nf,
    etiqueta,
    separacao,
  };

  // Etapa vazia não quer dizer a mesma coisa antes e depois de haver conta.
  // Sem esta contagem, a tela dizia "nenhuma conta conectada" com uma conta
  // conectada e sete pedidos na aba ao lado.
  const { count: contasConectadas } = await supabase
    .from("contas")
    .select("id", { count: "exact", head: true })
    .eq("situacao", "conectada");

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
            contagem: listasDoDia ?? 0,
            ativa: vista === "listas",
            // Fora da esteira: a esteira é ABERTO > FATURADO > SEPARAR >
            // CONFERIR > PRONTO, e só. A lista não é uma etapa — é o registro
            // do papel que saiu, guardado para quando uma caixa some.
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
            {feito && <Feito feito={feito} quantos={quantos} recusados={recusados} />}
            {falha && (
              <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] font-semibold text-critico">
                {falha === "todos_ja_em_lista"
                  ? "Esses pacotes já estão numa lista ativa."
                  : falha === "sem_motivo"
                    ? "Diga por que está retendo — o motivo vai para o histórico do pacote."
                  : falha === "nada_selecionado"
                    ? "Nenhum pedido marcado."
                  : falha === "pacote_fora_de_separar"
                    ? "Só pacote em Separar entra em lista."
                  : falha === "pacote_sem_sku_mapeado"
                    ? "Tem anúncio sem SKU correspondente. Mapeie em Integração — sem SKU o produto não aparece na lista nem tem código para bipar."
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
          /* Agrupar por causa serve para consertar uma vez e liberar trinta.
             Mas ela também precisa ver e ABRIR cada pedido — é assim que ela
             trabalha hoje na Lexos. As duas coisas convivem: a causa em cima,
             os pedidos embaixo, na mesma lista das outras abas. */
          <div className="flex flex-1 flex-col overflow-y-auto">
            <AbertoPorCausa
              resultado={reprocesso}
              temPacotes={(pacotes?.length ?? 0) > 0}
            />
            {pacotes && pacotes.length > 0 && (
              <ListaPacotes
                pacotes={pacotes as unknown as LinhaPacote[]}
                etapa="aberto"
                vista="aberto"
                valores={(valoresDeFiltro ?? []) as ValorDeFiltro[]}
                filtros={filtrosAtivos}
                permissoes={[...pode]}
                listas={Object.fromEntries(listaDoPacote)}
              />
            )}
          </div>
        ) : vista === "conferir" && !pacote && (await modoBipagemLigado(bipagem)) ? (
          /* A fila à esquerda só existe no modo bipagem. Com ele desligado,
             Conferir continua sendo a lista de largura inteira. */
          <EsperandoBipe
            fila={(pacotes ?? []) as never[]}
            bipe={bipe}
            codigo={codigoBipado}
            veValores={pode.has("ver_valores")}
          />
        ) : pacote ? (
          <PainelDetalhe
            fila={(pacotes ?? []) as never[]}
            pacoteId={pacote}
            etapa={etapaAtiva}
            liberacao={liberacao}
            etiqueta={impressaoEtiqueta}
            aba={aba}
          />
        ) : error ? (
          <Vazio
            titulo="Não foi possível ler a esteira"
            texto={error.message}
            critico
          />
        ) : !pacotes || pacotes.length === 0 ? (
          <Vazio {...vazioDaEtapa(etapaAtiva, (contasConectadas ?? 0) > 0)} />
        ) : (
          <div className="flex flex-1 flex-col">
            {vista === "conferir" && <ChamarModoBipagem />}
            <ListaPacotes
              pacotes={pacotes as unknown as LinhaPacote[]}
              etapa={etapaAtiva}
              vista={vista}
              valores={(valoresDeFiltro ?? []) as ValorDeFiltro[]}
              filtros={filtrosAtivos}
              permissoes={[...pode]}
              listas={Object.fromEntries(listaDoPacote)}
            />
          </div>
        )}
      </div>
    </Casca>
  );
}



function Explicacao({ vista }: { vista: Vista }) {
  const texto: Partial<Record<Vista, string>> = {
    listas:
      "Registro das listas emitidas: quais pedidos entraram e quem separou.",
    aberto:
      "Só faturamento e SKU — o que a gente resolve no cadastro e reprocessa.",
    faturado:
      "Nota autorizada, esperando a etiqueta do canal. Não há o que corrigir aqui.",
    separar:
      "Nota e etiqueta prontas. Gerar a lista imprime o papel e manda os pedidos para Conferir.",
    conferir: "Separado, esperando a bipagem na bancada.",
    pronto: "Conferido e lacrado, esperando a entrega na doca.",
    enviado: "Saiu pela porta. O que está aqui já foi bipado na saída e não volta sozinho.",
    retido:
      "Fora da esteira: cancelamento, endereço trocado, modalidade alterada pelo canal.",
  };
  return <span>{texto[vista]}</span>;
}

/**
 * O que dizer quando a etapa está vazia.
 *
 * Vazio por não haver conta e vazio por não haver trabalho são coisas
 * diferentes, e dizer a primeira quando é a segunda manda a pessoa procurar
 * defeito onde não há.
 */
function vazioDaEtapa(etapa: Etapa, temConta: boolean) {
  if (!temConta) {
    return {
      titulo: "Nenhuma conta conectada",
      texto:
        "A esteira fica vazia até a primeira conta do Mercado Livre ser ligada na Integração. Nada aqui é dado de exemplo.",
    };
  }

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

  if (etapa === "faturado") {
    return {
      titulo: "Ninguém esperando etiqueta",
      texto:
        "Os pedidos param aqui só enquanto o Mercado Livre não libera a etiqueta. Assim que ela sai, seguem sozinhos para Separar.",
    };
  }

  if (etapa === "separar") {
    return {
      titulo: "Nada para separar",
      texto:
        "O pedido chega aqui quando a nota está autorizada e a etiqueta foi obtida. Enquanto isso ele fica em Faturado ou em Aberto.",
    };
  }

  if (etapa === "conferir") {
    return {
      titulo: "Nada para conferir",
      texto:
        "Os pedidos chegam aqui ao gerar a lista de separação, na aba Separar.",
    };
  }

  if (etapa === "enviado") {
    return {
      titulo: "Nada enviado ainda",
      texto:
        "As caixas chegam aqui ao serem bipadas na saída, na Logística. É o fim da esteira.",
    };
  }

  return {
    titulo: "Nada pronto pra envio",
    texto:
      "Aqui ficam as caixas lacradas, esperando alguém levá-las para a doca.",
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


/**
 * O que a ação em lote fez.
 *
 * Diz o número e nomeia o que ficou de fora. "Concluído" esconderia que três
 * dos dez não foram — e o operador só descobriria quando a caixa errada
 * chegasse na doca.
 */
function Feito({
  feito,
  quantos,
  recusados,
}: {
  feito: string;
  quantos?: string;
  recusados?: string;
}) {
  const lista = (() => {
    try {
      return JSON.parse(recusados ?? "[]") as { codigo: string; motivo: string }[];
    } catch {
      return [];
    }
  })();

  const verbo = feito === "retidos" ? "retidos" : "devolvidos para a esteira";

  return (
    <span className="rounded-md border border-ok-linha bg-ok-bg px-[9px] py-[3px] font-semibold text-ok">
      {quantos} {Number(quantos) === 1 ? "pedido" : "pedidos"} {verbo}
      {lista.length > 0 && (
        <span className="font-normal text-critico">
          {" · "}
          {lista.map((r) => `${r.codigo} (${r.motivo})`).join(", ")} de fora
        </span>
      )}
    </span>
  );
}
