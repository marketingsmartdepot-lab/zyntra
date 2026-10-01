import Link from "next/link";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { permissoesDeAgora } from "@/lib/permissoes";
import { noAparelho } from "@/lib/operador";
import { QuemEVoce } from "@/components/quem-e-voce";
import { sairDoAparelho } from "@/app/identificar-acoes";
import { CampoDoColetor } from "./campo";
import {
  biparSeparacao,
  escolherNaSeparacao,
  fecharSeparacao,
} from "./acoes";

export const metadata = { title: "Separação — ZYNTRA" };

type Item = {
  sku_id: string;
  codigo: string;
  descricao: string | null;
  foto_url: string | null;
  codigo_barras: string | null;
  esperado: number;
  separado: number;
  faltam: number;
  completo: boolean;
  pacotes: number;
};

type Lista = {
  id: string;
  codigo: string;
  situacao: string;
  modo: string;
};

/**
 * A tela do coletor.
 *
 * Desenhada para uma tela de cinco polegadas segurada com uma mão, no
 * corredor: nada de barra lateral, nada de tabela que role para o lado, e o
 * alvo do dedo grande o bastante para acertar sem parar de andar. É a mesma
 * ZYNTRA — o coletor é Android com Chrome, não precisa de aplicativo.
 *
 * O leitor do aparelho se comporta como teclado, então o campo é um input
 * comum que se re-foca sozinho depois de cada leitura.
 */
export default async function TelaDaSeparacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    r?: string;
    codigo?: string;
    nome?: string;
    sep?: string;
    esp?: string;
    entre?: string;
    pedidos?: string;
    quem?: string;
    eu?: string;
  }>;
}) {
  const { id } = await params;
  const { r, codigo, nome, sep, esp, entre, pedidos, quem, eu } =
    await searchParams;

  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?destino=/separacao/${id}`);

  const pode = await permissoesDeAgora();
  if (!pode.has("ver_expedicao")) redirect("/");

  // Quem está com o coletor. O aparelho fica logado com a conta da equipe; o
  // PIN diz quem está no corredor agora. `eu` cobre o desenho logo após a
  // identificação, quando o cookie recém-gravado ainda não é visível.
  const operador = (await noAparelho()) ?? (eu ? { id: eu, nome: "" } : null);

  if (!operador) {
    return (
      <QuemEVoce
        voltar={`/separacao/${id}`}
        titulo="Separação"
        aviso={quem}
      />
    );
  }

  const [{ data: lista }, { data: itens }] = await Promise.all([
    supabase
      .from("listas_separacao")
      .select("id, codigo, situacao, modo")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("separacao_progresso")
      .select("*")
      .eq("lista_id", id)
      .order("codigo"),
  ]);

  const l = lista as Lista | null;
  const linhas = (itens ?? []) as Item[];

  // Nao achou, ou achou e a lista foi para o PAPEL: nos dois casos a pessoa
  // esta com o aparelho na mao e precisa de um caminho, nao de um aviso. Entao
  // a tela oferece as listas que estao mesmo em separacao.
  if (!l || l.situacao !== "em_separacao") {
    const { data: emAberto } = await supabase
      .from("listas_separacao")
      .select("id, codigo")
      .eq("situacao", "em_separacao")
      .order("criada_em", { ascending: false });

    const abertas = (emAberto ?? []) as { id: string; codigo: string }[];

    return (
      <Moldura
        titulo={l ? `Lista ${l.codigo}` : "Lista não encontrada"}
        quemEsta={operador.nome}
        voltarPara={`/separacao/${id}`}
      >
        <p
          className={`m-0 mb-4 rounded-[12px] border px-4 py-4 text-[15px] ${
            r === "fechada"
              ? "border-ok-linha bg-ok-bg font-semibold text-ok"
              : "border-atencao-linha bg-atencao-bg text-atencao"
          }`}
        >
          {!l
            ? "Esta lista não existe. Confira o endereço."
            : l.situacao === "concluida"
              ? r === "fechada"
                ? `Separação fechada. ${pedidos ?? ""} ${Number(pedidos ?? 0) === 1 ? "pedido foi" : "pedidos foram"} para Conferir.`
                : "Esta separação já foi fechada."
              : "Esta lista foi gerada para o papel, não para o coletor. Quem separa por papel não bipa aqui."}
        </p>

        {abertas.length > 0 ? (
          <>
            <p className="m-0 mb-2 text-[13px] font-semibold text-suave">
              Listas em separação agora:
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {abertas.map((x) => (
                <li key={x.id}>
                  <Link
                    href={`/separacao/${x.id}`}
                    className="block rounded-[12px] border border-linha bg-superficie px-4 py-4 text-[16px] font-semibold no-underline"
                  >
                    {x.codigo}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="m-0 text-[13.5px] leading-snug text-suave">
            Nenhuma lista em separação agora. Elas aparecem aqui quando alguém
            usa <b className="font-semibold">Mandar pro coletor</b> na aba
            Separar.
          </p>
        )}

        <Link
          href="/expedicao?etapa=separar"
          className="mt-4 block rounded-[12px] border border-linha px-4 py-4 text-center text-[15px] font-semibold no-underline"
        >
          Ir para Separar
        </Link>
      </Moldura>
    );
  }

  const feitos = linhas.filter((i) => i.completo).length;
  const unidadesFeitas = linhas.reduce((t, i) => t + i.separado, 0);
  const unidadesTotal = linhas.reduce((t, i) => t + i.esperado, 0);
  const tudoVerde = linhas.length > 0 && feitos === linhas.length;

  const candidatos = (() => {
    if (r !== "ambiguo" || !entre) return [];
    try {
      return JSON.parse(entre) as {
        sku_id: string;
        codigo: string;
        descricao: string | null;
        separado: number;
        esperado: number;
      }[];
    } catch {
      return [];
    }
  })();

  return (
    <Moldura
      titulo={`Lista ${l.codigo}`}
      quemEsta={operador.nome}
      voltarPara={`/separacao/${id}`}
    >
      {/* -------------------------------------------------- o progresso */}
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[34px] font-bold leading-none tabular-nums">
          {feitos}
          <span className="text-[20px] font-semibold text-suave">
            {" "}
            de {linhas.length}
          </span>
        </span>
        <span className="text-[13px] text-suave">
          {unidadesFeitas} de {unidadesTotal} unidades
        </span>
      </div>

      {/* ------------------------------------------------------ o bipe */}
      <form action={biparSeparacao} className="mb-3">
        <input type="hidden" name="lista" value={l.id} />
        <CampoDoColetor />
      </form>

      <Resposta
        r={r}
        codigo={codigo}
        nome={nome}
        sep={sep}
        esp={esp}
        candidatos={candidatos}
        listaId={l.id}
      />

      {/* ----------------------------------------------------- a lista */}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {linhas.map((i) => (
          <li
            key={i.sku_id}
            className={`rounded-[12px] border px-3 py-3 ${
              i.completo
                ? "border-ok-linha bg-ok-bg"
                : i.separado > 0
                  ? "border-atencao-linha bg-atencao-bg"
                  : "border-linha bg-superficie"
            }`}
          >
            <div className="flex items-start gap-3">
              {i.foto_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={i.foto_url}
                  alt=""
                  width={46}
                  height={46}
                  className="h-[46px] w-[46px] shrink-0 rounded-[8px] border border-linha object-cover"
                />
              ) : (
                <span className="h-[46px] w-[46px] shrink-0 rounded-[8px] border border-linha" />
              )}

              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[14px] font-bold">
                  {i.codigo}
                </span>
                <span className="block text-[13px] leading-snug">
                  {i.descricao ?? "produto sem descrição"}
                </span>
                {i.codigo_barras && (
                  <span className="mt-[2px] block font-mono text-[11px] text-suave">
                    {i.codigo_barras}
                  </span>
                )}
              </span>

              <span className="shrink-0 text-right">
                <span
                  className={`block font-mono text-[26px] font-bold leading-none tabular-nums ${
                    i.completo ? "text-ok" : ""
                  }`}
                >
                  {i.separado}
                  <span className="text-[16px] text-suave">/{i.esperado}</span>
                </span>
                {i.completo && (
                  <span className="mt-1 block text-[12px] font-semibold text-ok">
                    ✓ completo
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* ---------------------------------------------------- o fecho */}
      <form action={fecharSeparacao} className="mt-4">
        <input type="hidden" name="lista" value={l.id} />
        <button
          type="submit"
          disabled={!tudoVerde}
          className={`w-full rounded-[12px] px-4 py-5 text-[17px] font-semibold ${
            tudoVerde
              ? "bg-tinta text-white"
              : "border border-linha text-suave opacity-60"
          }`}
        >
          {tudoVerde
            ? "Fechar a separação"
            : `Faltam ${linhas.length - feitos} ${linhas.length - feitos === 1 ? "produto" : "produtos"}`}
        </button>
      </form>

      {!tudoVerde && (
        <p className="mt-2 text-center text-[12.5px] leading-snug text-suave">
          A lista só fecha com tudo verde. Se um produto não está na prateleira,
          chame quem pode resolver — a caixa não sai incompleta.
        </p>
      )}
    </Moldura>
  );
}

/** A moldura do coletor: sem lateral, sem cromo, a tela inteira é a lista. */
function Moldura({
  titulo,
  children,
  quemEsta,
  voltarPara,
}: {
  titulo: string;
  children: React.ReactNode;
  /** O nome de quem está com o aparelho, quando já se identificou. */
  quemEsta?: string;
  voltarPara?: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-fundo px-3 py-3">
      <header className="mb-3 flex items-center gap-3">
        <h1 className="m-0 text-[17px] font-bold tracking-[-0.01em]">
          {titulo}
        </h1>
        <span className="flex-1" />
        {quemEsta && (
          <form action={sairDoAparelho}>
            <input type="hidden" name="voltar" value={voltarPara} />
            <button
              type="submit"
              title="Sair do aparelho"
              className="rounded-lg border border-linha px-3 py-2 text-[13px] font-semibold text-suave"
            >
              {quemEsta} · sair
            </button>
          </form>
        )}
      </header>
      {children}
    </main>
  );
}

/** O que houve com o último bipe, grande o bastante para ler de relance. */
function Resposta({
  r,
  codigo,
  nome,
  sep,
  esp,
  candidatos,
  listaId,
}: {
  r?: string;
  codigo?: string;
  nome?: string;
  sep?: string;
  esp?: string;
  listaId: string;
  candidatos: {
    sku_id: string;
    codigo: string;
    descricao: string | null;
    separado: number;
    esperado: number;
  }[];
}) {
  if (!r) return null;

  if (r === "ambiguo") {
    return (
      <div className="mb-3 rounded-[12px] border border-atencao-linha bg-atencao-bg px-3 py-3">
        <p className="m-0 mb-2 text-[14px] font-semibold text-atencao">
          Este código serve para {candidatos.length} produtos desta lista. Qual
          você pegou?
        </p>
        <div className="flex flex-col gap-2">
          {candidatos.map((c) => (
            <form key={c.sku_id} action={escolherNaSeparacao}>
              <input type="hidden" name="lista" value={listaId} />
              <input type="hidden" name="sku" value={c.sku_id} />
              <button
                type="submit"
                className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-3 text-left"
              >
                <span className="block font-mono text-[13px] font-bold">
                  {c.codigo}
                </span>
                <span className="block text-[13px]">{c.descricao}</span>
                <span className="block text-[12px] text-suave">
                  {c.separado} de {c.esperado} separados
                </span>
              </button>
            </form>
          ))}
        </div>
      </div>
    );
  }

  const bom = r === "ok";
  const texto: Record<string, string> = {
    ok: `${nome ?? codigo} · ${sep} de ${esp}`,
    desconhecido: `${codigo} não está no catálogo.`,
    nao_pertence: `${nome ?? codigo} não é desta lista.`,
    ja_completo: `${nome ?? codigo} já está completo.`,
    codigo_vazio: "Nada foi lido.",
    faltam_itens: "Ainda falta produto. A lista não fecha.",
    // Produto sem SKU não tem código de barras, então não há como bipá-lo: a
    // lista nunca ficaria verde. Quem resolve é a Integração, não o corredor.
    itens_sem_sku:
      "Tem produto sem SKU nesta lista. Avise a expedição — não dá para fechar.",
    lista_nao_esta_em_separacao: "Esta lista não está mais em separação.",
    erro: "Não foi possível registrar. Bipe de novo.",
  };

  return (
    <p
      role="status"
      className={`m-0 mb-3 rounded-[12px] border px-3 py-3 text-[15px] font-semibold ${
        bom
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[r] ?? "Não foi possível registrar."}
    </p>
  );
}
