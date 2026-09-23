"use client";

import { useActionState } from "react";
import { gerarToken, type ResultadoToken } from "./acoes";

const INICIAL: ResultadoToken = { token: null, erro: null };

export function BotaoToken({
  impressoraId,
  jaTem,
}: {
  impressoraId: string;
  jaTem: boolean;
}) {
  const [estado, acao, pendente] = useActionState(gerarToken, INICIAL);

  return (
    <div>
      <form action={acao}>
        <input type="hidden" name="impressora" value={impressoraId} />
        <button
          type="submit"
          disabled={pendente}
          className="rounded-lg border border-linha px-3 py-[7px] text-[12.5px] font-semibold disabled:opacity-60"
        >
          {pendente
            ? "Gerando…"
            : jaTem
              ? "Gerar novo token"
              : "Gerar token do agente"}
        </button>
      </form>

      {estado.erro && (
        <p role="alert" className="mt-2 text-[12px] font-semibold text-critico">
          {estado.erro}
        </p>
      )}

      {estado.token && (
        <div className="mt-2 rounded-lg border border-atencao-linha bg-atencao-bg p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-atencao">
            Copie agora — não aparece de novo
          </p>
          <code className="mt-2 block break-all rounded border border-atencao-linha bg-superficie px-2 py-[6px] font-mono text-[12px]">
            {estado.token}
          </code>
          <p className="mt-2 text-[11.5px] text-atencao">
            Guardamos só o hash. Se perder, gere outro — e o anterior para de
            valer na hora.
          </p>
        </div>
      )}
    </div>
  );
}
