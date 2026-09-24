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
  pedidos: {
    ref_externa: string;
    comprador: string | null;
  } | null;
};

type Mapeamento = {
  ref_anuncio: string;
  ref_variacao: string | null;
  skus: { codigo: string; descricao: string | null; foto_url: string | null } | null;
};

/**
 * O que o cliente comprou, com a foto.
 *
 * A foto do ANÚNCIO, não a do produto: é ela que o comprador viu, e é por ela
 * que alguém reconhece a caixa errada de relance. A foto do produto do ERP só
 * entra quando o anúncio não tem — anúncio de kit mostra o combo montado, que
 * não ajuda quem precisa achar três lâmpadas na prateleira.
 *
 * Nenhuma das duas é preenchida enquanto não houver sincronização com o canal
 * e com o Bling. Por isso o espaço da foto é desenhado para ficar digno vazio,
 * e não para parecer defeito.
 */
export async function ItensDoPedido({ pacoteId }: { pacoteId: string }) {
  const supabase = await criarClienteServidor();

  const { data: pacote } = await supabase
    .from("pacotes")
    .select("envio_id")
    .eq("id", pacoteId)
    .maybeSingle();

  const envioId = (pacote as { envio_id: string } | null)?.envio_id;
  if (!envioId) return null;

  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id, conta_id")
    .eq("envio_id", envioId);

  const ids = ((pedidos ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return null;

  const contaId = ((pedidos ?? []) as { conta_id: string }[])[0]?.conta_id;

  const [{ data: dados }, { data: mapas }] = await Promise.all([
    supabase
      .from("pedido_itens")
      .select(
        `id, titulo, ref_anuncio, ref_variacao, sku_informado, foto_url,
         quantidade, preco_unitario,
         pedidos ( ref_externa, comprador )`,
      )
      .in("pedido_id", ids)
      .order("id"),
    supabase
      .from("mapeamentos_anuncio")
      .select("ref_anuncio, ref_variacao, skus ( codigo, descricao, foto_url )")
      .eq("conta_id", contaId),
  ]);

  const itens = (dados ?? []) as unknown as LinhaItem[];
  if (itens.length === 0) return null;

  const mapa = new Map<string, Mapeamento>();
  for (const m of (mapas ?? []) as unknown as Mapeamento[]) {
    mapa.set(`${m.ref_anuncio}|${m.ref_variacao ?? ""}`, m);
  }

  const unidades = itens.reduce((t, i) => t + i.quantidade, 0);
  const pedidosDistintos = new Set(
    itens.map((i) => i.pedidos?.ref_externa).filter(Boolean),
  );
  const semSku = itens.filter(
    (i) => !mapa.get(`${i.ref_anuncio}|${i.ref_variacao ?? ""}`)?.skus,
  ).length;

  return (
    <section className="mx-6 mb-5 overflow-hidden rounded-[10px] border border-linha">
      <header className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-4 py-3">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          O que o cliente comprou
        </h3>
        <span className="text-[12px] text-suave">
          {itens.length} {itens.length === 1 ? "item" : "itens"} · {unidades}{" "}
          {unidades === 1 ? "unidade" : "unidades"}
          {pedidosDistintos.size > 1 &&
            ` · ${pedidosDistintos.size} pedidos nesta caixa`}
        </span>
        <span className="flex-1" />
        {semSku > 0 && (
          <span className="rounded-full border border-critico-linha bg-critico-bg px-[9px] py-[3px] text-[11.5px] font-semibold text-critico">
            {semSku} sem SKU
          </span>
        )}
      </header>

      <ul className="m-0 list-none p-0">
        {itens.map((i) => {
          const m = mapa.get(`${i.ref_anuncio}|${i.ref_variacao ?? ""}`);
          const sku = m?.skus ?? null;
          const foto = i.foto_url ?? sku?.foto_url ?? null;

          return (
            <li
              key={i.id}
              className="flex items-start gap-4 border-b border-linha-suave px-4 py-3 last:border-b-0"
            >
              <Foto url={foto} alt={i.titulo ?? "Produto"} />

              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13.5px] font-medium leading-snug">
                  {i.titulo ?? "Produto sem título"}
                </p>
                <p className="m-0 mt-[3px] font-mono text-[11.5px] text-suave">
                  {i.ref_anuncio}
                  {i.ref_variacao && ` · var ${i.ref_variacao}`}
                  {pedidosDistintos.size > 1 &&
                    i.pedidos?.ref_externa &&
                    ` · pedido ${i.pedidos.ref_externa}`}
                </p>

                {sku ? (
                  <p className="m-0 mt-[5px] text-[12px]">
                    <span className="font-mono font-semibold">{sku.codigo}</span>
                    {sku.descricao && (
                      <span className="text-suave"> — {sku.descricao}</span>
                    )}
                  </p>
                ) : (
                  <p className="m-0 mt-[5px] text-[12px] font-semibold text-critico">
                    Anúncio sem SKU correspondente
                    {i.sku_informado && (
                      <span className="font-normal text-suave">
                        {" "}
                        · o canal informou{" "}
                        <span className="font-mono">{i.sku_informado}</span>
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <div className="font-mono text-[20px] font-semibold tabular-nums">
                  {i.quantidade}
                </div>
                <div className="text-[11px] text-suave">
                  {i.quantidade === 1 ? "unidade" : "unidades"}
                </div>
                {i.preco_unitario !== null && (
                  <div className="mt-[3px] font-mono text-[11.5px] text-suave tabular-nums">
                    {Number(i.preco_unitario).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Sem foto, o espaço continua ocupado pelo mesmo tamanho.
 *
 * Um item sem imagem entre itens com imagem desalinharia a lista inteira — e
 * lista desalinhada é mais difícil de ler de relance do que lista sem foto
 * nenhuma.
 */
function Foto({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={url}
        alt={alt}
        width={64}
        height={64}
        className="block h-16 w-16 shrink-0 rounded-[7px] border border-linha object-contain"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-linha text-suave"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8 12 3 3 8l9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </svg>
    </span>
  );
}
