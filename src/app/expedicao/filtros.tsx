import Link from "next/link";

type Opcao = { id: string; nome: string };

/**
 * Os filtros da esteira.
 *
 * Um campo de busca só, e não um por coluna: quem está na bancada tem um papel
 * na mão com um número e não sabe se aquele número é pedido, pack ou envio.
 * A busca cobre os três, mais cliente, SKU e título do anúncio.
 *
 * Formulário por GET, de propósito: o filtro fica no endereço. Assim dá para
 * mandar o link de uma seleção para outra pessoa, e voltar para a mesma tela
 * depois de gerar uma lista.
 */
export function Filtros({
  vista,
  busca,
  conta,
  modalidade,
  contas,
  modalidades,
  encontrados,
}: {
  vista: string;
  busca?: string;
  conta?: string;
  modalidade?: string;
  contas: Opcao[];
  modalidades: Opcao[];
  encontrados: number;
}) {
  const filtrando = Boolean(busca || conta || modalidade);

  return (
    <form
      method="GET"
      action="/expedicao"
      className="flex flex-wrap items-center gap-2 border-b border-linha bg-fundo px-5 py-[10px]"
    >
      <input type="hidden" name="etapa" value={vista} />

      <input
        name="busca"
        defaultValue={busca ?? ""}
        placeholder="Pedido, pack, envio, cliente, SKU ou anúncio"
        aria-label="Buscar"
        className="w-[320px] max-w-full rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[13px]"
      />

      {contas.length > 1 && (
        <select
          name="conta"
          defaultValue={conta ?? ""}
          aria-label="Conta"
          className="rounded-lg border border-linha bg-superficie px-2 py-[7px] text-[13px]"
        >
          <option value="">Todas as contas</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      )}

      <select
        name="modalidade"
        defaultValue={modalidade ?? ""}
        aria-label="Modalidade"
        className="rounded-lg border border-linha bg-superficie px-2 py-[7px] text-[13px]"
      >
        <option value="">Todas as modalidades</option>
        {modalidades.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[12.5px] font-semibold"
      >
        Filtrar
      </button>

      {filtrando && (
        <>
          <Link
            href={`/expedicao?etapa=${vista}`}
            className="rounded-lg px-2 py-[7px] text-[12.5px] font-semibold text-suave no-underline"
          >
            Limpar
          </Link>
          <span className="text-[12.5px] text-suave">
            <b className="font-semibold text-tinta">{encontrados}</b>
            {encontrados === 1 ? " encontrado" : " encontrados"}
          </span>
        </>
      )}
    </form>
  );
}
