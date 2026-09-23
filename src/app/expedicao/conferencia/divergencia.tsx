"use client";

import { useState } from "react";
import { abrirDivergencia, liberarDivergencia } from "./acoes";

export type DivergenciaAberta = {
  id: string;
  tipo: string;
  detalhe: string | null;
  aberta_em: string;
};

export type Lider = { id: string; nome: string };

const TIPOS = [
  { valor: "falta", rotulo: "Falta unidade", ajuda: "a caixa tem menos do que a venda pede" },
  { valor: "sobra", rotulo: "Sobra unidade", ajuda: "veio mais do que a venda pede" },
  { valor: "avaria", rotulo: "Produto avariado", ajuda: "chegou danificado na bancada" },
  { valor: "item_errado", rotulo: "Item errado", ajuda: "não é o produto da venda" },
  { valor: "sem_codigo", rotulo: "Produto sem código", ajuda: "não tem etiqueta para bipar" },
];

const ROTULO_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.rotulo]));

/**
 * A saída registrada de uma conferência que não fecha.
 *
 * Sem ela o operador fica preso na bancada com a fila parada atrás, e a saída
 * que ele inventa sozinho é pior: empurrar a caixa para o lado e seguir, sem
 * registro nenhum de que faltou alguma coisa.
 */
export function AbrirDivergencia({ conferenciaId }: { conferenciaId: string }) {
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-[10px] border border-linha px-[18px] py-[14px] text-[13.5px] font-semibold"
      >
        Registrar divergência
      </button>
    );
  }

  return (
    <form
      action={abrirDivergencia}
      className="w-full rounded-[10px] border border-atencao-linha bg-atencao-bg p-4"
    >
      <input type="hidden" name="conferencia" value={conferenciaId} />

      <p className="m-0 mb-3 text-[13.5px] font-semibold text-atencao">
        O que houve com este pacote?
      </p>

      <div className="mb-3 flex flex-col gap-[6px]">
        {TIPOS.map((t, i) => (
          <label
            key={t.valor}
            htmlFor={`div-${t.valor}`}
            className="flex cursor-pointer items-baseline gap-[9px] text-[13px]"
          >
            <input
              id={`div-${t.valor}`}
              type="radio"
              name="tipo"
              value={t.valor}
              defaultChecked={i === 0}
              required
              className="accent-[var(--color-tinta)]"
            />
            <span>
              <b className="font-semibold">{t.rotulo}</b>
              <span className="text-suave"> — {t.ajuda}</span>
            </span>
          </label>
        ))}
      </div>

      <label
        htmlFor="div-detalhe"
        className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
      >
        O que o líder precisa saber
      </label>
      <input
        id="div-detalhe"
        name="detalhe"
        placeholder="ex.: vieram 2 lâmpadas, a venda pede 3"
        className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
        >
          Registrar e chamar o líder
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * A liberação. O líder vem até a bancada e digita o PIN dele.
 *
 * É autorização física de propósito: antes bastava o líder estar logado em
 * qualquer lugar do galpão para o próprio operador liberar a própria
 * divergência, o que fazia do controle um enfeite.
 */
export function LiberarDivergencia({
  divergencia,
  pacoteId,
  lideres,
  resultado,
}: {
  divergencia: DivergenciaAberta;
  pacoteId: string;
  lideres: Lider[];
  resultado?: string;
}) {
  return (
    <div className="mx-6 mb-4 overflow-hidden rounded-[10px] border border-critico-linha">
      <div className="bg-critico-bg px-4 py-3">
        <p className="m-0 text-[14px] font-bold text-critico">
          Divergência aberta: {ROTULO_TIPO[divergencia.tipo] ?? divergencia.tipo}
        </p>
        {divergencia.detalhe && (
          <p className="m-0 mt-1 text-[12.5px] text-[#7A2C24]">
            {divergencia.detalhe}
          </p>
        )}
        <p className="m-0 mt-1 text-[12px] text-[#7A2C24]">
          Este pacote não fecha e não imprime até um líder liberar.
        </p>
      </div>

      {resultado && resultado !== "ok" && (
        <p
          role="alert"
          className="m-0 border-t border-critico-linha bg-critico-bg px-4 py-[10px] text-[12.5px] font-semibold text-critico"
        >
          {mensagem(resultado)}
        </p>
      )}

      {lideres.length === 0 ? (
        <p className="m-0 border-t border-linha px-4 py-3 text-[12.5px] text-suave">
          Nenhum líder cadastrado com PIN. Sem isso ninguém consegue liberar —
          cadastre em Integração antes de travar um pacote de verdade.
        </p>
      ) : (
        <form
          action={liberarDivergencia}
          className="flex flex-wrap items-end gap-3 border-t border-linha px-4 py-3"
        >
          <input type="hidden" name="divergencia" value={divergencia.id} />
          <input type="hidden" name="pacote" value={pacoteId} />

          <div>
            <label
              htmlFor="lib-lider"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Líder
            </label>
            <select
              id="lib-lider"
              name="lider"
              required
              className="w-[180px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            >
              {lideres.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="lib-pin"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              PIN
            </label>
            <input
              id="lib-pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              className="w-[104px] rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[15px] tracking-[0.3em]"
            />
          </div>

          <div className="min-w-[220px] flex-1">
            <label
              htmlFor="lib-motivo"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Motivo da liberação
            </label>
            <input
              id="lib-motivo"
              name="motivo"
              required
              placeholder="ex.: conferido comigo, segue com 2"
              className="w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Liberar
          </button>
        </form>
      )}
    </div>
  );
}

function mensagem(resultado: string) {
  const texto: Record<string, string> = {
    pin_incorreto: "PIN incorreto.",
    bloqueado:
      "Este líder errou o PIN cinco vezes e está bloqueado por dez minutos.",
    nao_e_lider: "Só um líder ativo pode liberar.",
    lider_sem_pin:
      "Este líder ainda não tem PIN cadastrado, então não consegue liberar.",
    motivo_obrigatorio:
      "Escreva o motivo. É o que explica a diferença quando alguém olhar depois.",
    divergencia_nao_encontrada: "Esta divergência já foi liberada.",
    dados_incompletos: "Faltou escolher o líder.",
  };
  return texto[resultado] ?? "Não foi possível liberar.";
}
