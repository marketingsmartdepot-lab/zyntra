/**
 * Leitor de ZIP, só o suficiente para a etiqueta do Mercado Livre.
 *
 * O ML devolve `response_type=zpl2` como arquivo ZIP quando há mais de uma
 * etiqueta, e como texto cru quando há uma só — pelo menos é o que a
 * documentação e os relatos indicam. Como não dá para confirmar sem token, o
 * chamador olha os bytes e decide; este módulo trata só o caso ZIP.
 *
 * Sem dependência de propósito: só APIs de plataforma (DataView,
 * DecompressionStream), que existem tanto no Deno da Edge Function quanto no
 * Node — é o que permite testar este arquivo fora da nuvem.
 *
 * Lê pelo DIRETÓRIO CENTRAL e não varrendo cabeçalhos locais: quando o ZIP é
 * gerado em streaming, o cabeçalho local vem com tamanho zero e o tamanho real
 * só existe no diretório central. Varrer daria arquivo vazio sem erro nenhum.
 */

const ASSINATURA_FIM_DIRETORIO = 0x06054b50;
const ASSINATURA_ENTRADA_CENTRAL = 0x02014b50;
const ASSINATURA_CABECALHO_LOCAL = 0x04034b50;

export type EntradaZip = { nome: string; conteudo: Uint8Array };

export function ehZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

export async function lerZip(bytes: Uint8Array): Promise<EntradaZip[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fim = acharFimDoDiretorio(v, bytes.length);

  if (fim < 0) throw new Error("ZIP sem diretório central");

  const quantas = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);

  const saida: EntradaZip[] = [];

  for (let i = 0; i < quantas; i++) {
    if (v.getUint32(p, true) !== ASSINATURA_ENTRADA_CENTRAL) {
      throw new Error("entrada do diretório central inválida");
    }

    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const tamanhoNome = v.getUint16(p + 28, true);
    const tamanhoExtra = v.getUint16(p + 30, true);
    const tamanhoComentario = v.getUint16(p + 32, true);
    const posicaoLocal = v.getUint32(p + 42, true);

    const nome = new TextDecoder().decode(
      bytes.subarray(p + 46, p + 46 + tamanhoNome),
    );

    if (v.getUint32(posicaoLocal, true) !== ASSINATURA_CABECALHO_LOCAL) {
      throw new Error(`cabeçalho local inválido em ${nome}`);
    }

    // O cabeçalho local tem os PRÓPRIOS tamanhos de nome e extra, que podem
    // diferir dos do diretório central. Usar os do central aqui erraria o
    // começo dos dados por alguns bytes.
    const inicio =
      posicaoLocal +
      30 +
      v.getUint16(posicaoLocal + 26, true) +
      v.getUint16(posicaoLocal + 28, true);

    const bruto = bytes.subarray(inicio, inicio + comprimido);

    saida.push({
      nome,
      conteudo:
        metodo === 0
          ? bruto
          : metodo === 8
            ? await inflarCru(bruto)
            : (() => {
                throw new Error(`método de compressão ${metodo} não suportado`);
              })(),
    });

    p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return saida;
}

/**
 * O fim do diretório central fica no final do arquivo, mas pode ter até 64 KB
 * de comentário depois. Por isso a busca é de trás para frente.
 */
function acharFimDoDiretorio(v: DataView, tamanho: number): number {
  const limite = Math.max(0, tamanho - 22 - 0xffff);
  for (let i = tamanho - 22; i >= limite; i--) {
    if (v.getUint32(i, true) === ASSINATURA_FIM_DIRETORIO) return i;
  }
  return -1;
}

async function inflarCru(bytes: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/**
 * Junta o ZPL das entradas de texto do ZIP.
 *
 * O pacote do ML traz também um PDF da PLP, que não serve para a Zebra: só o
 * que começa com `^XA` é ZPL e vai para a impressora.
 */
export function zplDoZip(entradas: EntradaZip[]): string {
  const texto = new TextDecoder();
  return entradas
    .filter((e) => !e.nome.toLowerCase().endsWith(".pdf"))
    .map((e) => texto.decode(e.conteudo))
    .filter((t) => t.includes("^XA"))
    .join("\n")
    .trim();
}
