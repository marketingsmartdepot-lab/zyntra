import { criarClienteServidor } from "@/lib/supabase/server";

type LinhaItem = {
  id: string;
  titulo: string | null;
  ref_anuncio: string;
  ref_variacao: string | null;
  sku_informado: string | null;
  foto_url: string | null;
  quantidade: number;
  preco_unitario: number | null;
  pedidos: { ref_externa: string; comprador: string | null } | null;
};

type Mapeamento = {
  ref_anuncio: string;
  ref_variacao: string | null;
  skus: {
    id: string;
    codigo: string;
    descricao: string | null;
    foto_url: string | null;
  } | null;
};

/** Uma linha da tabela: por SKU, não por anúncio. */
type LinhaSku = {
  chave: string;
  sku_id: string | null;
  codigo: string;
  descricao: string;
  quantidade: number;
  preco_unitario: number | null;
  foto: string | null;
  mapeado: boolean;
};

/**
 * O pedido como ela lê hoje: dados à esquerda, foto à direita, e embaixo a
 * tabela do que foi comprado com a coluna do que já foi bipado.
 *
 * A tabela é agrupada por SKU, e não por anúncio, porque é o SKU que a pessoa
 * bipa. Dois anúncios da mesma peça viram uma linha só — senão a coluna "Lido"
 * mostraria o mesmo número duas vezes e pareceria erro de contagem.
 */
export async function BlocoDoPedido({
  pacoteId,
  conferenciaId,
}: {
  pacoteId: string;
  /** Existe conferência em andamento? É dela que sai a coluna "Lido". */
  conferenciaId?: string | null;
}) {
  const supabase = await criarClienteServidor();

  const { data: pacote } = await supabase
    .from("pacotes")
    .select(
      `envio_id,
       envios ( ref_externa, limite_envio_em, modalidades ( nome ) ),
       contas ( apelido, canais ( nome, icone_url, sigla, cor, cor_texto ) )`,
    )
    .eq("id", pacoteId)
    .maybeSingle();

  const p = pacote as unknown as {
    envio_id: string;
    envios: {
      ref_externa: string;
      limite_envio_em: string | null;
      modalidades: { nome: string } | null;
    } | null;
    contas: {
      apelido: string;
      canais: {
        nome: string;
        icone_url: string | null;
        sigla: string | null;
        cor: string | null;
        cor_texto: string | null;
      } | null;
    } | null;
  } | null;

  if (!p?.envio_id) return null;

  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id, conta_id, comprador, ref_externa")
    .eq("envio_id", p.envio_id);

  const listaPedidos = (pedidos ?? []) as {
    id: string;
    conta_id: string;
    comprador: string | null;
    ref_externa: string;
  }[];
  const ids = listaPedidos.map((x) => x.id);
  if (ids.length === 0) return null;

  const contaId = listaPedidos[0]?.conta_id;

  const [{ data: dados }, { data: mapas }, { data: nota }, { data: lidos }] =
    await Promise.all([
      supabase
        .from("pedido_itens")
        .select(
          `id, titulo, ref_anuncio, ref_variacao, sku_informado, foto_url,
           quantidade, preco_unitario, pedidos ( ref_externa, comprador )`,
        )
        .in("pedido_id", ids)
        .order("id"),
      supabase
        .from("mapeamentos_anuncio")
        .select("ref_anuncio, ref_variacao, skus ( id, codigo, descricao, foto_url )")
        .eq("conta_id", contaId),
      supabase
        .from("notas_fiscais")
        .select("situacao, serie, numero")
        .eq("pacote_id", pacoteId)
        .order("atualizado_em", { ascending: false })
        .limit(1),
      conferenciaId
        ? supabase
            .from("conferencia_itens")
            .select("sku_id, quantidade_lida")
            .eq("conferencia_id", conferenciaId)
        : Promise.resolve({ data: [] as { sku_id: string; quantidade_lida: number }[] }),
    ]);

  const itens = (dados ?? []) as unknown as LinhaItem[];
  if (itens.length === 0) return null;

  const mapa = new Map<string, Mapeamento>();
  for (const m of (mapas ?? []) as unknown as Mapeamento[]) {
    mapa.set(`${m.ref_anuncio}|${m.ref_variacao ?? ""}`, m);
  }

  const lido = new Map<string, number>();
  for (const l of (lidos ?? []) as { sku_id: string; quantidade_lida: number }[]) {
    lido.set(l.sku_id, l.quantidade_lida);
  }

  // Agrupar por SKU. Sem SKU, cada anúncio é sua própria linha: são peças que
  // ninguém consegue afirmar serem a mesma.
  const porSku = new Map<string, LinhaSku>();
  for (const i of itens) {
    const m = mapa.get(`${i.ref_anuncio}|${i.ref_variacao ?? ""}`);
    const sku = m?.skus ?? null;
    const chave = sku ? `sku:${sku.id}` : `anuncio:${i.id}`;
    const atual = porSku.get(chave);

    if (atual) {
      atual.quantidade += i.quantidade;
    } else {
      porSku.set(chave, {
        chave,
        sku_id: sku?.id ?? null,
        codigo: sku?.codigo ?? i.sku_informado ?? "—",
        descricao: sku?.descricao ?? i.titulo ?? "Produto sem descrição",
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        foto: i.foto_url ?? sku?.foto_url ?? null,
        mapeado: Boolean(sku),
      });
    }
  }

  const linhas = [...porSku.values()];
  const unidades = linhas.reduce((t, l) => t + l.quantidade, 0);
  const total = linhas.reduce(
    (t, l) => t + (l.preco_unitario ?? 0) * l.quantidade,
    0,
  );
  const fotoPrincipal = linhas.find((l) => l.foto)?.foto ?? null;
  const canal = p.contas?.canais ?? null;
  const nf = (nota ?? [])[0] as
    | { situacao: string; serie: string | null; numero: number | null }
    | undefined;
  const compradores = [
    ...new Set(listaPedidos.map((x) => x.comprador).filter(Boolean)),
  ] as string[];

  return (
    <div className="px-6">
      {/* ---------------------------------------- dados e foto, lado a lado */}
      <div className="flex flex-wrap items-start gap-6 pb-5">
        <div className="min-w-[280px] flex-1">
          {canal && (
            <p className="m-0 mb-3 flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]">
              <Icone canal={canal} />
              {canal.nome}
            </p>
          )}

          <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-[6px] text-[13px]">
            <Rotulo>Cliente</Rotulo>
            <dd className="m-0 font-semibold">
              {compradores.length > 0 ? compradores.join(", ") : "—"}
            </dd>

            <Rotulo>Loja</Rotulo>
            <dd className="m-0 font-semibold">{p.contas?.apelido ?? "—"}</dd>

            <Rotulo>Transportadora</Rotulo>
            <dd className="m-0 font-semibold">
              {p.envios?.modalidades?.nome ?? "não classificada"}
            </dd>

            <Rotulo>Data limite</Rotulo>
            <dd className="m-0 font-semibold">
              {p.envios?.limite_envio_em
                ? new Date(p.envios.limite_envio_em).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Sao_Paulo",
                  })
                : "sem prazo do canal"}
            </dd>

            <Rotulo>Nota fiscal</Rotulo>
            <dd className="m-0">
              <SeloNota nf={nf} />
            </dd>

            {listaPedidos.length > 1 && (
              <>
                <Rotulo>Pedidos nesta caixa</Rotulo>
                <dd className="m-0 font-mono text-[12px] font-semibold">
                  {listaPedidos.map((x) => x.ref_externa).join(" · ")}
                </dd>
              </>
            )}
          </dl>
        </div>

        <FotoGrande url={fotoPrincipal} alt={linhas[0]?.descricao ?? "Produto"} />
      </div>

      {/* --------------------------------------------------------- a tabela */}
      <div className="overflow-x-auto rounded-[10px] border border-linha">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Cabecalho largura="132px">Sku</Cabecalho>
              <Cabecalho>Descrição</Cabecalho>
              <Cabecalho largura="76px" direita>Qtd</Cabecalho>
              <Cabecalho largura="116px" direita>Preço</Cabecalho>
              <Cabecalho largura="86px" direita>Lido</Cabecalho>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const qtdLida = l.sku_id ? (lido.get(l.sku_id) ?? 0) : 0;
              const completo = qtdLida >= l.quantidade;

              return (
                <tr key={l.chave} className="border-t border-linha-suave">
                  <Celula>
                    {l.mapeado ? (
                      <span className="font-mono text-[12.5px] font-semibold">
                        {l.codigo}
                      </span>
                    ) : (
                      <span className="font-mono text-[12.5px] font-semibold text-critico">
                        {l.codigo}
                        <span className="block text-[10.5px] font-normal">
                          sem SKU no catálogo
                        </span>
                      </span>
                    )}
                  </Celula>
                  <Celula>
                    <span className="text-[13px]">{l.descricao}</span>
                  </Celula>
                  <Celula direita>
                    <span className="font-mono text-[13px] tabular-nums">
                      {l.quantidade}
                    </span>
                  </Celula>
                  <Celula direita>
                    <span className="font-mono text-[13px] text-suave tabular-nums">
                      {l.preco_unitario === null
                        ? "—"
                        : Number(l.preco_unitario).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                    </span>
                  </Celula>
                  <Celula direita>
                    <span
                      className={`font-mono text-[13px] font-semibold tabular-nums ${
                        qtdLida === 0
                          ? "text-suave"
                          : completo
                            ? "text-[var(--color-ok)]"
                            : "text-atencao"
                      }`}
                    >
                      {qtdLida}
                    </span>
                  </Celula>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha bg-fundo">
              <td className="px-3 py-[10px] text-[12px] text-suave" colSpan={2}>
                {linhas.length} {linhas.length === 1 ? "item" : "itens"}
              </td>
              <td className="px-3 py-[10px] text-right font-mono text-[13px] font-semibold tabular-nums">
                {unidades}
              </td>
              <td className="px-3 py-[10px] text-right font-mono text-[13px] font-semibold tabular-nums">
                {total.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </td>
              <td className="px-3 py-[10px]" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <dt className="font-medium text-suave">{children}:</dt>;
}

function Cabecalho({
  children,
  largura,
  direita,
}: {
  children?: React.ReactNode;
  largura?: string;
  direita?: boolean;
}) {
  return (
    <th
      style={largura ? { width: largura } : undefined}
      className={`whitespace-nowrap bg-fundo px-3 py-[9px] text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave ${
        direita ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Celula({
  children,
  direita,
}: {
  children: React.ReactNode;
  direita?: boolean;
}) {
  return (
    <td className={`px-3 py-[10px] align-top ${direita ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

function SeloNota({
  nf,
}: {
  nf?: { situacao: string; serie: string | null; numero: number | null };
}) {
  if (!nf) {
    return (
      <span className="rounded-full border border-atencao-linha bg-atencao-bg px-[9px] py-[2px] text-[11.5px] font-semibold text-atencao">
        Pedido sem NF-e
      </span>
    );
  }

  const tom: Record<string, string> = {
    autorizada:
      "border-[var(--color-ok)] bg-[var(--color-ok-bg)] text-[var(--color-ok)]",
    rejeitada: "border-critico-linha bg-critico-bg text-critico",
    cancelada: "border-critico-linha bg-critico-bg text-critico",
    solicitada: "border-atencao-linha bg-atencao-bg text-atencao",
  };

  const texto: Record<string, string> = {
    autorizada: "Autorizada",
    rejeitada: "Rejeitada",
    cancelada: "Cancelada",
    solicitada: "Solicitada",
  };

  return (
    <span
      className={`rounded-full border px-[9px] py-[2px] text-[11.5px] font-semibold ${
        tom[nf.situacao] ?? "border-linha text-suave"
      }`}
    >
      {texto[nf.situacao] ?? nf.situacao}
      {nf.numero && ` · ${nf.serie ?? ""}/${nf.numero}`}
    </span>
  );
}

function Icone({
  canal,
}: {
  canal: {
    nome: string;
    icone_url: string | null;
    sigla: string | null;
    cor: string | null;
    cor_texto: string | null;
  };
}) {
  if (canal.icone_url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={canal.icone_url}
        alt=""
        width={20}
        height={20}
        className="block h-5 w-5 rounded-[5px] object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        background: canal.cor ?? "var(--color-linha)",
        color: canal.cor_texto ?? "var(--color-tinta)",
      }}
      className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[10px] font-bold"
    >
      {canal.sigla ?? canal.nome.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * Sem foto o espaço continua o mesmo.
 *
 * Um item sem imagem ao lado de itens com imagem desalinha o bloco inteiro, e
 * bloco desalinhado é mais difícil de ler de relance do que bloco sem foto.
 */
function FotoGrande({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt={alt}
        width={232}
        height={232}
        className="block h-[232px] w-[232px] shrink-0 rounded-[10px] border border-linha object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-[232px] w-[232px] shrink-0 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-linha text-suave"
    >
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8 12 3 3 8l9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </svg>
      <span className="text-[11.5px]">sem foto no catálogo</span>
    </span>
  );
}
