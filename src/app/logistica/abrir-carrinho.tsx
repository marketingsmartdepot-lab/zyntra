import { abrirEntregaDoca } from "./acoes";

/**
 * Abre o carrinho que leva as caixas da expedição para a doca.
 *
 * Vive em dois lugares de propósito: na Doca, para quem já está lá, e na aba
 * Pronto pra envio, que é onde as caixas estão de fato quando alguém decide
 * levá-las. Obrigar a pessoa a trocar de frente para começar seria pedir que
 * ela largasse a pilha e fosse procurar o botão.
 *
 * O nome é pedido uma vez, na abertura: é uma pessoa por carrinho, e é por
 * esse nome que se descobre quem estava com a caixa quando ela some.
 */
export function AbrirCarrinho({
  compacto,
  aviso,
}: {
  /** No rodapé de uma lista, sem a moldura própria. */
  compacto?: boolean;
  aviso?: string;
}) {
  return (
    <form
      action={abrirEntregaDoca}
      className={
        compacto
          ? "flex flex-wrap items-end gap-2"
          : "flex flex-wrap items-end gap-2 rounded-[9px] border border-linha px-4 py-[14px]"
      }
    >
      <div>
        <label
          htmlFor={compacto ? "doca-quem-pronto" : "doca-quem"}
          className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
        >
          Quem está levando para a doca
        </label>
        <input
          id={compacto ? "doca-quem-pronto" : "doca-quem"}
          name="entregue_por"
          required
          placeholder="nome de quem empurra o carrinho"
          className="w-[280px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
      >
        Registrar entrega na doca
      </button>
      <span className="max-w-[46ch] text-[12.5px] text-suave">
        {aviso ?? "Depois é bipar cada caixa. O carrinho pode ser misto."}
      </span>
    </form>
  );
}
