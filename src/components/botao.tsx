"use client";

import { useFormStatus } from "react-dom";

/**
 * Botão que admite estar trabalhando.
 *
 * Sem isto, ações que falam com o Bling levam segundos e a tela não muda nada:
 * a pessoa clica, não acontece nada visível, clica de novo. No melhor caso ela
 * espera sem saber se funcionou; no pior, dispara a ação duas vezes.
 *
 * `useFormStatus` só enxerga o formulário acima dele, então este componente
 * precisa viver dentro do <form> — não em volta dele.
 */
export function Botao({
  children,
  trabalhando,
  className,
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** O que dizer enquanto a ação não volta. */
  trabalhando?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      {...resto}
      type="submit"
      disabled={pending || resto.disabled}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-progress disabled:opacity-60`}
    >
      {pending ? (trabalhando ?? "Aguarde…") : children}
    </button>
  );
}
