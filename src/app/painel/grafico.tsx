export type DiaDeVenda = {
  dia: string;
  total: number | string;
  pedidos: number;
  fim_de_semana: boolean;
};

/** A área de desenho. 1004 de largura casa 1:1 com a coluna em tela cheia. */
const LARGURA = 1004;
const ALTURA_BARRA = 130;
const BASE = 134;

/**
 * Vendas por dia.
 *
 * SVG desenhado à mão, sem biblioteca: são catorze a noventa retângulos e uma
 * linha de base. Carregar um pacote de gráficos para isso custaria mais do que
 * o gráfico inteiro.
 *
 * O melhor dia fica preto e o fim de semana em tom mais claro — sábado baixo
 * não é problema, é sábado, e deixá-lo igual aos outros faria a pessoa
 * procurar uma causa que não existe.
 */
export function GraficoDeVendas({ dias }: { dias: DiaDeVenda[] }) {
  if (dias.length === 0) return null;

  const valores = dias.map((d) => Number(d.total));
  const maior = Math.max(...valores);
  const melhor = valores.indexOf(maior);

  // Sem venda nenhuma o gráfico seria uma fileira de traços no chão. Isso não
  // informa: diz "vazio" pior do que uma frase diria.
  if (maior <= 0) {
    return (
      <p className="m-0 py-10 text-center text-[13.5px] text-suave">
        Nenhuma venda registrada no período. O gráfico ganha forma quando a
        primeira conta do Mercado Livre estiver conectada.
      </p>
    );
  }

  const vao = dias.length > 20 ? 5 : dias.length > 10 ? 8 : 12;
  const largura = (LARGURA - vao * (dias.length - 1)) / dias.length;

  // Com muitos dias, rotular todos vira uma tarja ilegível.
  const passoDoRotulo = dias.length > 16 ? Math.ceil(dias.length / 8) : 1;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${LARGURA} 172`}
        role="img"
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full min-w-[520px]"
      >
        <title>Vendas por dia no período</title>
        <desc>
          {`Barras diárias. O maior dia é ${dia(dias[melhor].dia)}, com ${moeda(
            maior,
          )}. Sábados e domingos aparecem em tom mais claro.`}
        </desc>

        <line
          x1="0"
          y1={BASE + 0.5}
          x2={LARGURA}
          y2={BASE + 0.5}
          stroke="var(--color-linha)"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1={BASE - ALTURA_BARRA / 2}
          x2={LARGURA}
          y2={BASE - ALTURA_BARRA / 2}
          stroke="var(--color-linha-suave)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />

        {dias.map((d, i) => {
          const valor = Number(d.total);
          const altura = Math.max(valor > 0 ? 2 : 0, (valor / maior) * ALTURA_BARRA);
          const x = i * (largura + vao);

          return (
            <rect
              key={d.dia}
              x={x}
              y={BASE - altura}
              width={largura}
              height={altura}
              rx={largura > 8 ? 4 : 2}
              fill={
                i === melhor
                  ? "var(--color-tinta)"
                  : d.fim_de_semana
                    ? "#ddd9ce"
                    : "#c9c5ba"
              }
            />
          );
        })}

        {dias.map((d, i) =>
          i % passoDoRotulo === 0 || i === melhor ? (
            <text
              key={`r-${d.dia}`}
              x={i * (largura + vao) + largura / 2}
              y="152"
              textAnchor="middle"
              fontSize="11"
              fontWeight={i === melhor ? 600 : 400}
              fill={i === melhor ? "var(--color-tinta)" : "var(--color-suave)"}
            >
              {d.dia.slice(8, 10)}
            </text>
          ) : null,
        )}

        <text x="0" y="168" fontSize="10.5" fill="var(--color-suave)">
          Sábado e domingo em tom mais claro
        </text>
      </svg>
    </div>
  );
}

export function moeda(valor: number | string) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: Number(valor) >= 1000 ? 0 : 2,
  });
}

export function dia(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
