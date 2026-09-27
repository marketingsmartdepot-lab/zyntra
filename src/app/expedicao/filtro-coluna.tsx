import Link from "next/link";

export type ValorDeFiltro = {
  coluna: string;
  valor: string;
  rotulo: string;
  quantos: number;
};

/**
 * O filtro dentro da coluna, com os valores que realmente existem nela.
 *
 * Só os dados, "selecionar todos" e seleção múltipla — sem ordenar, sem
 * filtros de texto, sem submenu. Quem separa precisa marcar Flex e Agência
 * juntos e seguir; cada item a mais no menu é um item a mais para ler antes
 * de achar o que interessa.
 *
 * Feito com <details> e um formulário GET: abre e fecha sem JavaScript, e o
 * filtro fica no endereço — dá para mandar o link da seleção para outra
 * pessoa.
 */
export function FiltroColuna({
  coluna,
  rotulo,
  valores,
  selecionados,
  outros,
}: {
  coluna: string;
  rotulo: string;
  valores: ValorDeFiltro[];
  selecionados: string[];
  /** Os outros filtros ativos, que precisam sobreviver a este envio. */
  outros: Record<string, string | undefined>;
}) {
  const ativo = selecionados.length > 0;
  const semNada = valores.length === 0;

  if (semNada) {
    return <span className="text-[10.5px] uppercase tracking-[0.12em]">{rotulo}</span>;
  }

  return (
    <details className="relative inline-block [&[open]>summary>svg]:rotate-180">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 text-[10.5px] uppercase tracking-[0.12em] ${
          ativo ? "text-tinta" : ""
        }`}
      >
        {rotulo}
        {ativo && (
          <span className="rounded-full bg-tinta px-[5px] text-[9px] font-bold leading-[14px] text-white">
            {selecionados.length}
          </span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
          className="transition-transform"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <form
        method="GET"
        action="/expedicao"
        className="absolute left-0 z-20 mt-2 w-[240px] rounded-[10px] border border-linha bg-superficie p-2 shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
      >
        {Object.entries(outros).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}

        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[7px] text-[12.5px] font-semibold hover:bg-fundo">
          {/* Sem nenhum marcado, o filtro já significa "todos" — então
              "selecionar todos" é simplesmente não mandar nada. */}
          <input
            type="checkbox"
            checked={!ativo}
            readOnly
            className="h-[14px] w-[14px] accent-[var(--color-tinta)]"
          />
          Selecionar todos
        </label>

        <div className="my-1 border-t border-linha-suave" />

        <div className="max-h-[220px] overflow-y-auto">
          {valores.map((v) => (
            <label
              key={v.valor}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-[7px] text-[12.5px] hover:bg-fundo"
            >
              <input
                type="checkbox"
                name={coluna}
                value={v.valor}
                defaultChecked={selecionados.includes(v.valor)}
                className="h-[14px] w-[14px] accent-[var(--color-tinta)]"
              />
              <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                {v.rotulo}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-suave">
                {v.quantos}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-linha-suave pt-2">
          <button
            type="submit"
            className="rounded-lg bg-tinta px-3 py-[6px] text-[12px] font-semibold text-white"
          >
            Aplicar
          </button>
          {ativo && (
            <Link
              href={enderecoSem(coluna, outros)}
              className="px-1 text-[12px] font-semibold text-suave no-underline"
            >
              Limpar
            </Link>
          )}
        </div>
      </form>
    </details>
  );
}

function enderecoSem(coluna: string, outros: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(outros)) if (v && k !== coluna) p.set(k, v);
  return `/expedicao?${p.toString()}`;
}
