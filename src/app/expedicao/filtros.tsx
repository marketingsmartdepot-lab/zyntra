import Link from "next/link";

/**
 * A busca da esteira.
 *
 * Um campo só, e não um por coluna: quem está na bancada tem um papel na mão
 * com um número e não sabe se aquele número é pedido, pack ou envio. A busca
 * cobre os três, mais cliente, SKU e título do anúncio.
 *
 * Conta, modalidade, NF-e e etiqueta não ficam aqui — ficam na própria coluna,
 * onde a pessoa está olhando quando decide filtrar.
 */
export function Busca({
  vista,
  busca,
  outros,
}: {
  vista: string;
  busca?: string;
  outros: Record<string, string | undefined>;
}) {
  const outrosFiltros = Object.entries(outros).filter(
    ([k, v]) => v && k !== "busca" && k !== "etapa",
  );

  return (
    <form
      method="GET"
      action="/expedicao"
      className="flex flex-wrap items-center gap-2 border-b border-linha bg-fundo px-5 py-[9px]"
    >
      <input type="hidden" name="etapa" value={vista} />
      {outrosFiltros.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <input
        name="busca"
        defaultValue={busca ?? ""}
        placeholder="Pedido, pack, envio, cliente, SKU ou anúncio"
        aria-label="Buscar"
        className="w-[330px] max-w-full rounded-lg border border-linha bg-superficie px-3 py-[6px] text-[12.5px]"
      />
      <button
        type="submit"
        className="rounded-lg border border-linha bg-superficie px-3 py-[6px] text-[12px] font-semibold"
      >
        Buscar
      </button>

      {(busca || outrosFiltros.length > 0) && (
        <Link
          href={`/expedicao?etapa=${vista}`}
          className="px-1 text-[12px] font-semibold text-suave no-underline"
        >
          Limpar tudo
        </Link>
      )}
    </form>
  );
}
