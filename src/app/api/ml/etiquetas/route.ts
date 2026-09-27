import { NextResponse, type NextRequest } from "next/server";
import { inflateRawSync } from "node:zlib";

/**
 * Busca a etiqueta do Mercado Livre e devolve o ZPL desembrulhado.
 *
 * Existe porque o ML entrega a etiqueta dentro de um ZIP — testado com zpl2,
 * zpl e sem formato nenhum: as três voltam application/zip. O banco não
 * descompacta ZIP, então este é o único passo da integração que precisa do
 * app. O resto continua no banco.
 *
 * Quem chama é o próprio banco, pelo pg_net, com um segredo compartilhado. Não
 * há sessão de usuário aqui: é máquina falando com máquina.
 *
 * O token do Mercado Livre vem no corpo. É de propósito: a alternativa seria
 * dar a esta rota uma chave de banco, e um token de uma conta que dura seis
 * horas é um estrago menor do que acesso total ao banco.
 */
export async function POST(request: NextRequest) {
  const segredo = process.env.ZYNTRA_SEGREDO_INTERNO;

  if (!segredo) {
    return NextResponse.json(
      { ok: false, motivo: "segredo_nao_configurado" },
      { status: 500 },
    );
  }

  if (request.headers.get("x-zyntra-segredo") !== segredo) {
    return NextResponse.json({ ok: false, motivo: "nao_autorizado" }, { status: 401 });
  }

  let corpo: { shipment_id?: string; token?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, motivo: "corpo_invalido" }, { status: 400 });
  }

  const { shipment_id, token } = corpo;
  if (!shipment_id || !token) {
    return NextResponse.json({ ok: false, motivo: "faltou_dado" }, { status: 400 });
  }

  const pedir = (formato: string) =>
    fetch(
      `https://api.mercadolibre.com/shipment_labels?shipment_ids=${encodeURIComponent(
        shipment_id,
      )}&response_type=${formato}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );

  let resposta: Response;
  let respostaPdf: Response | null = null;
  try {
    // Os dois formatos na mesma ida: o ZPL vai para a Zebra da bancada, e o
    // PDF é o que se lê na tela quando não há impressora por perto. Buscar o
    // PDF depois, sob demanda, exigiria o token do ML do lado do navegador.
    [resposta, respostaPdf] = await Promise.all([pedir("zpl2"), pedir("pdf")]);
  } catch (e) {
    return NextResponse.json(
      { ok: false, motivo: "rede", detalhe: e instanceof Error ? e.message : "?" },
      { status: 502 },
    );
  }

  if (!resposta.ok) {
    // O ML recusa quando o envio ainda não pode imprimir. Não é defeito: é a
    // sala de espera da etiqueta.
    const texto = await resposta.text().catch(() => "");
    return NextResponse.json(
      {
        ok: false,
        motivo: resposta.status === 400 ? "ainda_nao_pode_imprimir" : "recusado",
        status: resposta.status,
        detalhe: texto.slice(0, 300),
      },
      { status: 200 },
    );
  }

  const bytes = Buffer.from(await resposta.arrayBuffer());

  let conteudo: string;
  try {
    conteudo = primeiroArquivoDoZip(bytes);
  } catch (e) {
    return NextResponse.json(
      { ok: false, motivo: "zip_ilegivel", detalhe: e instanceof Error ? e.message : "?" },
      { status: 200 },
    );
  }

  if (!conteudo.trim()) {
    return NextResponse.json({ ok: false, motivo: "etiqueta_vazia" }, { status: 200 });
  }

  // O PDF é conforto, não operação: se falhar, a etiqueta ainda imprime.
  //
  // E ele NÃO vem zipado — só o ZPL vem. O ML responde application/pdf, cru.
  // Por isso o formato é decidido pelos primeiros bytes, e não pelo que se
  // esperava receber: %PDF é PDF, PK é zip.
  let pdf: string | null = null;
  try {
    if (respostaPdf?.ok) {
      const bytesPdf = Buffer.from(await respostaPdf.arrayBuffer());
      const marca = bytesPdf.subarray(0, 4).toString("latin1");

      const puro =
        marca === "%PDF"
          ? bytesPdf
          : marca.startsWith("PK")
            ? primeiroArquivoDoZipBinario(bytesPdf)
            : null;

      if (puro && puro.subarray(0, 4).toString("latin1") === "%PDF") {
        pdf = puro.toString("base64");
      }
    }
  } catch {
    pdf = null;
  }

  return NextResponse.json({ ok: true, formato: "zpl", conteudo, pdf });
}

/**
 * Tira o primeiro arquivo de um ZIP.
 *
 * Lê pelo índice do fim (o "diretório central"), e não pelo cabeçalho de cada
 * arquivo: quando o ZIP é gerado em fluxo, o cabeçalho vem com tamanho zero e
 * o tamanho real só existe no índice. Foi o caso de arquivos do próprio ML.
 */
function primeiroArquivoDoZip(buf: Buffer): string {
  return primeiroArquivoDoZipBinario(buf).toString("latin1");
}

/** O mesmo, sem virar texto: PDF é binário e latin1 o corromperia. */
function primeiroArquivoDoZipBinario(buf: Buffer): Buffer {
  // Fim do diretório central: PK\x05\x06, procurado de trás para frente
  // porque pode haver comentário depois dele.
  let fim = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("nao parece um zip");

  const entradas = buf.readUInt16LE(fim + 10);
  if (entradas === 0) throw new Error("zip vazio");

  const inicioIndice = buf.readUInt32LE(fim + 16);
  if (buf.readUInt32LE(inicioIndice) !== 0x02014b50) {
    throw new Error("indice do zip em lugar inesperado");
  }

  const metodo = buf.readUInt16LE(inicioIndice + 10);
  const comprimido = buf.readUInt32LE(inicioIndice + 20);
  const nomeTam = buf.readUInt16LE(inicioIndice + 28);
  const extraTam = buf.readUInt16LE(inicioIndice + 30);
  const comentarioTam = buf.readUInt16LE(inicioIndice + 32);
  const inicioLocal = buf.readUInt32LE(inicioIndice + 42);

  void extraTam;
  void comentarioTam;
  void nomeTam;

  if (buf.readUInt32LE(inicioLocal) !== 0x04034b50) {
    throw new Error("cabecalho do arquivo em lugar inesperado");
  }

  // O cabeçalho local tem os próprios tamanhos de nome e extra, que podem
  // diferir dos do índice.
  const nomeLocal = buf.readUInt16LE(inicioLocal + 26);
  const extraLocal = buf.readUInt16LE(inicioLocal + 28);
  const inicioDados = inicioLocal + 30 + nomeLocal + extraLocal;
  const dados = buf.subarray(inicioDados, inicioDados + comprimido);

  // 0 = guardado sem compressão, 8 = deflate. O ML usa deflate, mas guardado
  // acontece com arquivo pequeno.
  if (metodo === 0) return dados;
  if (metodo === 8) return inflateRawSync(dados);

  throw new Error(`compressao desconhecida: ${metodo}`);
}
