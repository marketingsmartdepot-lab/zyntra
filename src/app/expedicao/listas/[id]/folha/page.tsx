import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { AbrirImpressao } from "./imprimir";

export const metadata = { title: "Lista de separação — ZYNTRA" };

type Resumo = {
  codigo: string;
  criada_em: string;
  separador: string | null;
  gerada_por: string | null;
  pacotes: number;
  unidades: number;
  contas: string[] | null;
};

type Item = {
  codigo: string;
  descricao: string | null;
  codigo_barras: string | null;
  unidades: number;
  pacotes: number;
};

/**
 * A folha de separação, pronta para o papel.
 *
 * Página própria, sem a casca do sistema: o que sai na impressora é o que
 * está aqui. Preto no branco, sem depender do tema — folha que sai cinza
 * clara não se lê no corredor.
 *
 * E é o navegador que pergunta qual impressora. A folha é papel A4 comum, e a
 * impressora livre no corredor muda ao longo do dia; a bancada configurada
 * serve para a etiqueta térmica, que é sempre a mesma.
 */
export default async function FolhaDaLista({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/entrar?destino=/expedicao/listas/${id}/folha`);

  const [{ data: resumo }, { data: itens }] = await Promise.all([
    supabase.from("listas_resumo").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("listas_itens")
      .select("codigo, descricao, codigo_barras, unidades, pacotes")
      .eq("lista_id", id)
      .order("codigo"),
  ]);

  // De qual pedido é cada peça. A tabela é agrupada por SKU porque quem separa
  // pega da prateleira por produto, mas na hora de montar a caixa precisa
  // saber a qual pedido cada uma pertence — senão o papel diz "pegue 3" e não
  // diz para onde vão.
  const { data: vinculos } = await supabase
    .from("listas_pacotes")
    .select("pacotes ( envio_id )")
    .eq("lista_id", id);

  const envios = ((vinculos ?? []) as unknown as { pacotes: { envio_id: string } | null }[])
    .map((v) => v.pacotes?.envio_id)
    .filter(Boolean) as string[];

  const { data: pedidosDaLista } = await supabase
    .from("pedidos")
    .select("id, ref_externa, conta_id, envio_id")
    .in("envio_id", envios.length ? envios : ["-"]);

  const pedidosLista = (pedidosDaLista ?? []) as {
    id: string;
    ref_externa: string;
    conta_id: string;
    envio_id: string;
  }[];

  const [{ data: itensCrus }, { data: mapas }] = await Promise.all([
    supabase
      .from("pedido_itens")
      .select("pedido_id, ref_anuncio, ref_variacao, sku_informado")
      .in("pedido_id", pedidosLista.length ? pedidosLista.map((x) => x.id) : ["-"]),
    supabase
      .from("mapeamentos_anuncio")
      .select("conta_id, ref_anuncio, ref_variacao, skus ( codigo )"),
  ]);

  const mapa = new Map<string, string>();
  for (const m of (mapas ?? []) as unknown as {
    conta_id: string;
    ref_anuncio: string;
    ref_variacao: string | null;
    skus: { codigo: string } | null;
  }[]) {
    if (m.skus?.codigo) {
      mapa.set(`${m.conta_id}|${m.ref_anuncio}|${m.ref_variacao ?? ""}`, m.skus.codigo);
    }
  }

  const contaDo = new Map(pedidosLista.map((x) => [x.id, x.conta_id]));
  const refDo = new Map(pedidosLista.map((x) => [x.id, x.ref_externa]));

  const pedidosPorSku = new Map<string, Set<string>>();
  for (const i of (itensCrus ?? []) as {
    pedido_id: string;
    ref_anuncio: string;
    ref_variacao: string | null;
    sku_informado: string | null;
  }[]) {
    const conta = contaDo.get(i.pedido_id) ?? "";
    const codigo =
      mapa.get(`${conta}|${i.ref_anuncio}|${i.ref_variacao ?? ""}`) ??
      i.sku_informado ??
      "—";
    const ref = refDo.get(i.pedido_id);
    if (!ref) continue;
    if (!pedidosPorSku.has(codigo)) pedidosPorSku.set(codigo, new Set());
    pedidosPorSku.get(codigo)!.add(ref);
  }

  if (!resumo) {
    return (
      <main style={{ padding: 40, fontFamily: "system-ui", color: "#000" }}>
        <p>Lista não encontrada.</p>
      </main>
    );
  }

  const r = resumo as unknown as Resumo;
  const linhas = (itens ?? []) as Item[];

  return (
    <main className="folha">
      <AbrirImpressao />

      <style>{`
        /* Folha que sai cinza clara não se lê no corredor. */
        :root, body { background: #fff !important; color: #000 !important; }
        .folha { font-family: system-ui, -apple-system, sans-serif;
                 color: #000; background: #fff; padding: 24px; max-width: 900px; }
        .folha h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.02em; }
        .folha .sub { font-size: 12.5px; color: #333; margin: 0 0 18px; }
        .folha table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        .folha th { text-align: left; font-size: 10px; text-transform: uppercase;
                    letter-spacing: 0.1em; border-bottom: 1.5px solid #000;
                    padding: 6px 8px; }
        .folha td { border-bottom: 1px solid #ccc; padding: 9px 8px; font-size: 13px;
                    vertical-align: top; }
        .folha .num { text-align: right; font-variant-numeric: tabular-nums;
                      font-weight: 600; }
        .folha .cod { font-family: ui-monospace, monospace; font-weight: 600; }
        .folha .ped { font-family: ui-monospace, monospace; font-size: 11px;
                      line-height: 1.45; }
        .folha .ean { display: block; font-family: ui-monospace, monospace;
                      font-size: 10.5px; font-weight: 400; color: #555; }
        .folha .marcar { width: 26px; height: 18px; border: 1.2px solid #000;
                         display: inline-block; }
        .folha .rodape { font-size: 11px; color: #444; border-top: 1px solid #000;
                         padding-top: 8px; }
        @media print {
          .folha { padding: 0; max-width: none; }
          @page { margin: 14mm; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>

      <h1>Lista de separação {r.codigo}</h1>
      <p className="sub">
        Emitida{" "}
        {new Date(r.criada_em).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        })}
        {" · "}
        {linhas.length} {linhas.length === 1 ? "item" : "itens"}
        {" · "}
        {r.unidades} {r.unidades === 1 ? "unidade" : "unidades"}
        {" · "}
        {r.pacotes} {r.pacotes === 1 ? "pacote" : "pacotes"}
        {r.contas && r.contas.length > 0 && ` · ${r.contas.join(", ")}`}
        {r.separador && ` · separador: ${r.separador}`}
      </p>

      <table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>SKU</th>
            <th>Produto</th>
            <th style={{ width: 190 }}>Pedido</th>
            <th style={{ width: 62 }} className="num">Unid.</th>
            <th style={{ width: 74 }} className="num">Pacotes</th>
            <th style={{ width: 40 }}>Ok</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((li) => (
            <tr key={li.codigo}>
              <td className="cod">
                {li.codigo}
                {li.codigo_barras && <span className="ean">{li.codigo_barras}</span>}
              </td>
              <td>{li.descricao ?? "Produto sem descrição"}</td>
              <td className="ped">
                {[...(pedidosPorSku.get(li.codigo) ?? [])].join(" · ") || "—"}
              </td>
              <td className="num">{li.unidades}</td>
              <td className="num">{li.pacotes}</td>
              <td>
                <span className="marcar" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="rodape">
        Esta folha não substitui a conferência: cada pedido ainda passa pela
        bancada um a um. Sem endereço de prateleira nesta versão — o estoque
        fica na Lexos.
      </p>
    </main>
  );
}
