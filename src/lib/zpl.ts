/**
 * ZPL para a Zebra ZD220.
 *
 * 203 dpi, etiqueta de 4x6" — a mesma mídia da etiqueta de envio, porque é o
 * que tem na bancada. Em dots: 812 de largura, 1218 de altura.
 *
 * Duas coisas que quebram calado e por isso estão tratadas aqui:
 *
 * 1. `^` e `~` são comandos. Uma descrição de produto com `~` vira comando no
 *    meio do desenho e a etiqueta sai deformada ou não sai.
 * 2. Acento. Sem `^CI28` a impressora usa a tabela antiga e "LÂMPADA" sai
 *    "LMPADA" ou pior. É a primeira linha de todo formato.
 */

const LARGURA = 812;
const ALTURA = 1218;
const MARGEM = 24;

/** Onde o corpo começa e acaba, já descontados cabeçalho e rodapé. */
const CORPO_TOPO = 196;
const CORPO_FUNDO = ALTURA - 56;

/** Cada item ocupa duas linhas: código com quantidade, e descrição. */
const ALTURA_ITEM = 62;

const ITENS_POR_FOLHA = Math.floor((CORPO_FUNDO - CORPO_TOPO) / ALTURA_ITEM);

export type ItemDeSeparacao = {
  codigo: string;
  descricao: string | null;
  unidades: number;
  pacotes: number;
};

export type ListaParaImprimir = {
  codigo: string;
  pacotes: number;
  unidades: number;
  separador?: string | null;
};

/**
 * A folha que o separador leva no corredor.
 *
 * Agrupada por SKU e não por pedido: quem anda pelo corredor quer saber que
 * precisa de três lâmpadas, não que o pedido A quer uma e o B quer duas.
 * A separação por pedido acontece depois, na bancada.
 *
 * Uma lista longa vira várias folhas — a impressora é de etiqueta, não de A4.
 * O separador leva a tira.
 */
export function listaDeSeparacao(
  lista: ListaParaImprimir,
  itens: ItemDeSeparacao[],
): string {
  const folhas = repartir(itens, ITENS_POR_FOLHA);
  const total = Math.max(folhas.length, 1);

  return folhas
    .map((daFolha, i) => folhaDeSeparacao(lista, daFolha, i + 1, total))
    .join("");
}

function folhaDeSeparacao(
  lista: ListaParaImprimir,
  itens: ItemDeSeparacao[],
  folha: number,
  folhas: number,
): string {
  const l: string[] = [];

  l.push("^XA");
  l.push("^CI28"); // UTF-8. Sem isto, acento vira lixo.
  l.push(`^PW${LARGURA}`);
  l.push(`^LL${ALTURA}`);
  l.push("^LH0,0");

  // Cabeçalho
  l.push(texto(MARGEM, 26, 30, "LISTA DE SEPARAÇÃO"));
  l.push(texto(MARGEM, 62, 62, lista.codigo, true));

  // O separador bipa este código para abrir a lista na bancada.
  l.push(`^FO${LARGURA - MARGEM - 150},20^BQN,2,5^FDQA,${limpar(lista.codigo)}^FS`);

  l.push(
    texto(
      MARGEM,
      132,
      26,
      `${lista.pacotes} ${lista.pacotes === 1 ? "pacote" : "pacotes"} · ` +
        `${lista.unidades} ${lista.unidades === 1 ? "unidade" : "unidades"}` +
        (lista.separador ? ` · ${lista.separador}` : ""),
    ),
  );
  l.push(texto(MARGEM, 164, 22, agora()));

  l.push(`^FO${MARGEM},${CORPO_TOPO - 12}^GB${LARGURA - MARGEM * 2},3,3^FS`);

  // Corpo
  itens.forEach((item, i) => {
    const y = CORPO_TOPO + i * ALTURA_ITEM;

    // A quantidade é o que o separador lê primeiro, então é o maior número da
    // linha e fica na frente do código.
    l.push(texto(MARGEM, y, 40, `${item.unidades}`, true));
    l.push(texto(MARGEM + 76, y + 4, 34, cortar(item.codigo, 26), true));

    const nota =
      item.pacotes > 1
        ? `${cortar(item.descricao ?? "sem descrição", 44)}  (${item.pacotes} pedidos)`
        : cortar(item.descricao ?? "sem descrição", 56);
    l.push(texto(MARGEM + 76, y + 38, 22, nota));
  });

  if (itens.length === 0) {
    l.push(texto(MARGEM, CORPO_TOPO, 28, "Nenhum item com SKU mapeado."));
  }

  // Rodapé
  l.push(`^FO${MARGEM},${CORPO_FUNDO}^GB${LARGURA - MARGEM * 2},2,2^FS`);
  l.push(
    texto(
      MARGEM,
      CORPO_FUNDO + 12,
      24,
      folhas > 1 ? `folha ${folha} de ${folhas}` : "folha única",
    ),
  );
  l.push(texto(LARGURA - MARGEM - 120, CORPO_FUNDO + 12, 24, "ZYNTRA"));

  l.push("^XZ");

  return l.join("\n") + "\n";
}

function texto(
  x: number,
  y: number,
  altura: number,
  conteudo: string,
  forte = false,
): string {
  // `^A0` não tem variante negrito, e largura fixa só ESTREITA a letra — não
  // engorda. Negrito de verdade em térmica é imprimir o mesmo campo duas
  // vezes, deslocado um ponto: o segundo passe alarga o traço.
  const limpo = limpar(conteudo);
  const campo = (px: number) => `^FO${px},${y}^A0N,${altura},0^FD${limpo}^FS`;
  return forte ? `${campo(x)}\n${campo(x + 1)}` : campo(x);
}

/**
 * `^` e `~` são o que a impressora lê como comando, e `\` escapa. Sem isto,
 * uma descrição com til técnico embaralha o desenho inteiro.
 */
function limpar(s: string): string {
  return s.replace(/[\\^~]/g, " ").replace(/\s+/g, " ").trim();
}

function cortar(s: string, limite: number): string {
  const t = s.trim();
  return t.length <= limite ? t : `${t.slice(0, limite - 1)}…`;
}

function repartir<T>(itens: T[], por: number): T[][] {
  if (itens.length === 0) return [[]];
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += por) saida.push(itens.slice(i, i + por));
  return saida;
}

function agora(): string {
  return new Date().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}
