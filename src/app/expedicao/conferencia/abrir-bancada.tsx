"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { iniciarConferencia } from "./acoes";

/**
 * O botão que abre a bancada, e que agora diz quando não abre.
 *
 * Antes isto era um formulário de servidor que chamava `iniciarConferencia` e
 * DESCARTAVA a resposta: `await iniciarConferencia(pacoteId)`, sem olhar o
 * que voltou. Quando falhava — item sem SKU mapeado, pacote que saiu da etapa
 * no meio do caminho — a tela recarregava igualzinha, sem uma palavra. Quem
 * clicou conclui que o botão não funciona, e não que falta mapear um anúncio.
 *
 * Cliente e não servidor porque a mensagem precisa aparecer SEM trocar de
 * página: a pessoa está com a caixa na mão e a fila andando atrás dela.
 */
export function AbrirBancada({ pacoteId }: { pacoteId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, iniciarAbertura] = useTransition();

  function abrir() {
    iniciarAbertura(async () => {
      setErro(null);
      const r = await iniciarConferencia(pacoteId);

      if (!r.ok) {
        setErro(r.mensagem ?? "Não foi possível abrir a bancada.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="max-w-[48ch] text-[14px] leading-relaxed text-suave">
        Abrir a conferência congela o que tem que estar na caixa, já expandindo
        kit. O catálogo pode mudar no meio do turno, mas a caixa que o operador
        tem na mão é a de agora.
      </p>

      <button
        type="button"
        onClick={abrir}
        disabled={abrindo}
        className="rounded-[10px] bg-tinta px-[22px] py-[13px] text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {abrindo ? "Abrindo…" : "Abrir a bancada"}
      </button>

      {erro && (
        <p
          role="alert"
          className="m-0 max-w-[52ch] rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold leading-relaxed text-critico"
        >
          {erro}
        </p>
      )}
    </div>
  );
}
