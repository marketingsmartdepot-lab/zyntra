"use client";

import { useEffect, useRef } from "react";

/**
 * O campo que recebe o bipe no coletor.
 *
 * Foca sozinho ao abrir e volta a focar depois de cada leitura — o leitor do
 * aparelho é um teclado, e teclado sem foco não escreve em lugar nenhum. No
 * corredor isso é a diferença entre bipar andando e parar para tocar na tela.
 *
 * `inputMode="none"` pede ao Android para NÃO abrir o teclado virtual: o
 * teclado ocuparia metade da tela e esconderia a lista que a pessoa precisa
 * ver enquanto separa.
 */
export function CampoDoColetor() {
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  return (
    <input
      ref={campo}
      name="codigo"
      inputMode="none"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder="bipe o produto"
      aria-label="Bipe o produto que você pegou"
      className="w-full rounded-[12px] border-2 border-tinta bg-superficie px-4 py-5 text-center font-mono text-[20px] outline-none"
    />
  );
}
