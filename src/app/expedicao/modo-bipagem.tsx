import { alternarModoBipagem } from "./bipagem-acoes";

/**
 * O convite para ligar o modo bipagem, no topo da lista de Conferir.
 *
 * É só isto: com o modo desligado, a aba continua sendo a lista de largura
 * inteira, como em todas as outras etapas. Quem liga troca a tela por outra
 * — a da espera do bipe, com a fila ao lado.
 */
export function ChamarModoBipagem() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-5 py-[10px]">
      <form action={alternarModoBipagem}>
        <input type="hidden" name="ligar" value="1" />
        <button
          type="submit"
          className="rounded-lg border border-linha bg-superficie px-3 py-[7px] text-[12.5px] font-semibold"
        >
          Ligar modo bipagem
        </button>
      </form>
      <span className="text-[12px] text-suave">
        Com ele ligado você bipa o produto e o pedido abre sozinho, sem
        procurar na lista.
      </span>
    </div>
  );
}
