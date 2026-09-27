"use client";

import { useEffect, useRef } from "react";

/**
 * O campo que recebe o bipe.
 *
 * Foca sozinho ao abrir e volta a focar depois de cada leitura: o leitor de
 * código de barras é um teclado, e teclado sem foco não escreve em lugar
 * nenhum. Sem isto, a bancada bipa, não acontece nada, e o operador conclui
 * que o leitor quebrou.
 */
export function CampoQueFocaSozinho() {
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  return (
    <input
      ref={campo}
      name="codigo"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder="bipe o produto"
      aria-label="Bipe o produto para achar o pedido"
      className="w-[280px] rounded-lg border border-tinta bg-superficie px-3 py-[9px] font-mono text-[13.5px]"
    />
  );
}
