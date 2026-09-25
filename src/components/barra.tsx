import Link from "next/link";

export type TomDaAba = "neutro" | "atencao" | "critico";

export type AbaDaBarra = {
  chave: string;
  href: string;
  rotulo: string;
  /** `null` quando a aba não conta nada (Fechamento, Cadastros). */
  contagem?: number | null;
  /** Texto no lugar da contagem, quando o que importa não é um número. */
  legenda?: string;
  ativa: boolean;
  /** Cor da pastilha quando há o que olhar. Só estado, nunca decoração. */
  tom?: TomDaAba;
  /** Separa visualmente do grupo anterior — Retidos, Fechamento. */
  separadaAntes?: boolean;
};

/**
 * A barra superior das frentes.
 *
 * Existe uma só porque antes eram três cópias — uma na Expedição, uma na
 * Logística, uma na Integração — e três cópias divergem sozinhas. Foi o que
 * aconteceu: mesma ideia, três pesos e três espaçamentos.
 *
 * Duas decisões de leitura:
 *
 * O rótulo manda e a contagem é pastilha. Antes o número era 25px sobre um
 * rótulo de 10,5px, então a pessoa lia "0" antes de saber do que.
 *
 * Contagem zero não aparece. Oito zeros lado a lado eram ruído; a ausência da
 * pastilha já diz que não há nada ali. A aba ATIVA é a exceção: nela o zero
 * aparece, porque é a tela que a pessoa está olhando e "zero aqui" é resposta.
 */
export function Barra({
  rotulo,
  abas,
  explicacao,
  direita,
  rodapeDireita,
}: {
  /** Nome da navegação para quem usa leitor de tela. */
  rotulo: string;
  abas: AbaDaBarra[];
  explicacao?: React.ReactNode;
  /** Canto direito da linha das abas: o número que vale a pena ver sempre. */
  direita?: React.ReactNode;
  rodapeDireita?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-linha bg-superficie">
      <nav
        aria-label={rotulo}
        className="flex items-center gap-1 overflow-x-auto px-5 pt-[10px]"
      >
        {abas.map((a) => (
          <AbaDaBarra key={a.chave} aba={a} />
        ))}

        {direita && (
          <>
            <span className="flex-1" />
            <span className="shrink-0">{direita}</span>
          </>
        )}
      </nav>

      {(explicacao || rodapeDireita) && (
        <div className="flex items-center gap-3 px-5 pb-[11px] pt-[6px] text-[12px] text-suave">
          {explicacao}
          <span className="flex-1" />
          {rodapeDireita}
        </div>
      )}
    </div>
  );
}

function AbaDaBarra({ aba }: { aba: AbaDaBarra }) {
  const mostraContagem =
    aba.contagem !== null &&
    aba.contagem !== undefined &&
    (aba.contagem > 0 || aba.ativa);

  return (
    <>
      {aba.separadaAntes && (
        <span
          aria-hidden="true"
          className="mx-2 h-[22px] w-px shrink-0 bg-linha-suave"
        />
      )}

      <Link
        href={aba.href}
        aria-current={aba.ativa ? "page" : undefined}
        className={`flex shrink-0 items-center gap-2 rounded-[9px] px-[13px] py-[7px] text-[13px] font-semibold tracking-[-0.01em] no-underline ${
          aba.ativa
            ? "bg-tinta text-white"
            : "text-suave hover:bg-fundo hover:text-tinta"
        }`}
      >
        {aba.rotulo}

        {mostraContagem && (
          <span
            className={`rounded-[5px] px-[6px] py-px font-mono text-[12px] font-semibold tabular-nums ${pastilha(
              aba,
            )}`}
          >
            {aba.contagem}
          </span>
        )}

        {aba.legenda && (
          <span
            className={`text-[12px] font-medium ${
              aba.ativa ? "text-white/70" : "text-suave"
            }`}
          >
            {aba.legenda}
          </span>
        )}
      </Link>
    </>
  );
}

/**
 * A pastilha na aba ativa vive sobre preto, então ela é translúcida — cor de
 * estado ali dentro brigaria com o fundo e perderia o contraste.
 */
function pastilha(aba: AbaDaBarra) {
  if (aba.ativa) return "bg-white/[0.18] text-white";

  if (aba.tom === "critico") {
    return "border border-critico-linha bg-critico-bg text-critico";
  }
  if (aba.tom === "atencao") {
    return "border border-atencao-linha bg-atencao-bg text-atencao";
  }
  return "bg-fundo text-suave";
}

/**
 * O indicador do canto direito: um número que a pessoa quer ver sempre, ou o
 * estado de uma coisa que quebra a operação inteira.
 */
export function Indicador({
  rotulo,
  valor,
  tom = "neutro",
}: {
  rotulo?: string;
  valor: string;
  tom?: "neutro" | "ok" | "critico";
}) {
  const estilo =
    tom === "ok"
      ? "border-ok-linha bg-ok-bg text-ok"
      : tom === "critico"
        ? "border-critico-linha bg-critico-bg text-critico"
        : "border-linha text-tinta";

  return (
    <span
      className={`flex items-center gap-[7px] rounded-[9px] border px-3 py-[6px] ${estilo}`}
    >
      {tom !== "neutro" && (
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] rounded-full ${
            tom === "ok" ? "bg-ok" : "bg-critico"
          }`}
        />
      )}
      {rotulo && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-suave">
          {rotulo}
        </span>
      )}
      {/*
        Com rótulo é "coisa: número", e o número pede fonte de máquina para
        alinhar dígito. Sem rótulo é uma frase — fonte de texto.
      */}
      <span
        className={
          rotulo
            ? `font-mono text-[14px] font-semibold tabular-nums ${tom === "neutro" ? "text-tinta" : ""}`
            : "text-[12px] font-semibold"
        }
      >
        {valor}
      </span>
    </span>
  );
}
