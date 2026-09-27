"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Quantos pedidos estão marcados agora.
 *
 * Conta olhando as caixinhas do formulário, não guardando estado próprio: as
 * linhas são desenhadas no servidor, e quem sabe a verdade sobre o que está
 * marcado é o DOM. Estado paralelo aqui daria contagem errada na primeira vez
 * que a tabela mudasse por baixo.
 */
export function ContagemSelecionada() {
  const ancora = useRef<HTMLSpanElement>(null);
  const [quantos, setQuantos] = useState(0);

  useEffect(() => {
    const formulario = ancora.current?.closest("form");
    if (!formulario) return;

    const recontar = () =>
      setQuantos(
        formulario.querySelectorAll('input[name="pacote"]:checked').length,
      );

    recontar();

    // Dois eventos: `change` cobre o clique numa linha; `zyntra:selecao` cobre
    // o "selecionar todos", que mexe nas caixinhas por código — e marcar uma
    // caixinha por código não dispara `change` nenhum.
    formulario.addEventListener("change", recontar);
    formulario.addEventListener("zyntra:selecao", recontar);

    return () => {
      formulario.removeEventListener("change", recontar);
      formulario.removeEventListener("zyntra:selecao", recontar);
    };
  }, []);

  return (
    <span
      ref={ancora}
      aria-live="polite"
      className={`text-[12.5px] font-semibold tabular-nums ${
        quantos === 0 ? "text-suave" : "text-tinta"
      }`}
    >
      {quantos === 0
        ? "nenhum pedido selecionado"
        : `${quantos} ${quantos === 1 ? "pedido selecionado" : "pedidos selecionados"}`}
    </span>
  );
}
