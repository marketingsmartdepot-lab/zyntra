"use client";

/**
 * A caixinha do cabeçalho: marca e desmarca a lista inteira de uma vez.
 *
 * Fala com as caixinhas das linhas pelo formulário que as contém, e não por
 * estado compartilhado: as linhas são desenhadas no servidor, e transformar a
 * tabela toda em componente de cliente para marcar caixinha seria pagar caro
 * por pouco.
 */
export function MarcarTodos() {
  return (
    <input
      type="checkbox"
      aria-label="Selecionar todos os pedidos desta aba"
      title="Selecionar todos"
      className="h-[15px] w-[15px] cursor-pointer accent-[var(--color-tinta)]"
      onChange={(e) => {
        const marcar = e.currentTarget.checked;
        const formulario = e.currentTarget.closest("form");
        if (!formulario) return;

        formulario
          .querySelectorAll<HTMLInputElement>('input[name="pacote"]')
          .forEach((caixa) => {
            caixa.checked = marcar;
          });

        // Marcar caixinha por código não dispara `change`. Sem este aviso, a
        // contagem ao lado diria zero depois de selecionar tudo.
        formulario.dispatchEvent(new CustomEvent("zyntra:selecao"));
      }}
    />
  );
}
