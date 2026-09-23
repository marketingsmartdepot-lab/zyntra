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
import { ListaPacotes } from "./lista";
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
  searchParams: Promise<{ etapa?: string; pacote?: string; lista?: string; falha?: string }>;
}) {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/expedicao");

  const { etapa: pedida, pacote, lista, falha } = await searchParams;
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
      <nav
        aria-label="Etapas da esteira"
        className="flex shrink-0 items-stretch gap-[30px] overflow-x-auto border-b border-linha bg-superficie px-5"
      >
        {ABAS_EXPEDICAO.map((a) => (
          <Aba
            key={a.etapa}
            etapa={a.etapa}
            rotulo={a.rotulo}
            contagem={porEtapa.get(a.etapa) ?? 0}
            ativa={vista === a.etapa}
          />
        ))}

        <AbaVista
          chave="listas"
          rotulo="Lista de separação"
          contagem={listasAbertas ?? 0}
          ativa={vista === "listas"}
        />

        <span className="my-[15px] w-px shrink-0 bg-linha" />

        <Aba
          etapa="retido"
          rotulo="Retidos"
          contagem={porEtapa.get("retido") ?? 0}
          ativa={vista === "retido"}
          foraDaEsteira
        />

        <span className="flex-1" />
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-b border-linha bg-fundo px-5 py-[11px] text-[12.5px] text-suave">
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
        <span className="flex-1" />
        <span>
          <b className="font-semibold text-tinta">{pacotes?.length ?? 0}</b>{" "}
          {pacotes?.length === 1 ? "pacote" : "pacotes"}
        </span>
      </div>

      <div className="flex flex-1 flex-col bg-superficie">
        {vista === "listas" ? (
          <PainelListas listaId={lista} />
        ) : vista === "aberto" && !pacote ? (
          <AbertoPorCausa />
        ) : pacote ? (
          <PainelDetalhe
            fila={(pacotes ?? []) as never[]}
            pacoteId={pacote}
            etapa={etapaAtiva}
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
          <ListaPacotes
            pacotes={pacotes as unknown as LinhaPacote[]}
            etapa={etapaAtiva}
            selecionavel={vista === "separar"}
          />
        )}
      </div>
    </Casca>
  );
}

function Aba({
  etapa,
  rotulo,
  contagem,
  ativa,
  foraDaEsteira,
}: {
  etapa: Etapa;
  rotulo: string;
  contagem: number;
  ativa: boolean;
  foraDaEsteira?: boolean;
}) {
  const alerta =
    (etapa === "aberto" || etapa === "retido") && contagem > 0
      ? etapa === "aberto"
        ? "text-critico"
        : "text-atencao"
      : etapa === "faturado" && contagem > 0
        ? "text-atencao"
        : ativa
          ? "text-tinta"
          : "text-[#43464D]";

  return (
    <Link
      href={`/expedicao?etapa=${etapa}`}
      aria-current={ativa ? "page" : undefined}
      className={`flex shrink-0 flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] no-underline ${
        ativa ? "border-tinta text-tinta" : "border-transparent text-suave"
      }`}
    >
      <span className="flex items-center gap-[6px] text-[10.5px] font-semibold uppercase tracking-[0.13em]">
        {foraDaEsteira && (
          <span className="h-[6px] w-[6px] rounded-full bg-atencao" />
        )}
        {rotulo}
      </span>
      <span
        className={`text-[25px] font-bold leading-none tracking-[-0.02em] tabular-nums ${alerta}`}
      >
        {contagem}
      </span>
    </Link>
  );
}

function AbaVista({
  chave,
  rotulo,
  contagem,
  ativa,
}: {
  chave: string;
  rotulo: string;
  contagem: number;
  ativa: boolean;
}) {
  return (
    <Link
      href={`/expedicao?etapa=${chave}`}
      aria-current={ativa ? "page" : undefined}
      className={`flex shrink-0 flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] no-underline ${
        ativa ? "border-tinta text-tinta" : "border-transparent text-suave"
      }`}
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
        {rotulo}
      </span>
      <span
        className={`text-[25px] font-bold leading-none tracking-[-0.02em] tabular-nums ${
          ativa ? "text-tinta" : "text-[#43464D]"
        }`}
      >
        {contagem}
      </span>
    </Link>
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
