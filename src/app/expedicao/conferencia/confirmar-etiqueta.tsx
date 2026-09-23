"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Retorno = { ok: boolean; motivo: string; impressao_id: string | null };

/**
 * A prova física de que saiu papel.
 *
 * "Impressa" no sistema significa que a impressora aceitou o comando — não que
 * a etiqueta existe. Papel acabado, ribbon no fim, etiqueta que saiu em branco:
 * em todos esses casos o sistema diria impressa e a caixa sairia sem etiqueta.
 * A única prova é alguém bipar o papel que está na mão.
 */
export function ConfirmarEtiqueta({
  pacoteId,
  operadorId,
}: {
  pacoteId: string;
  operadorId: string | null;
}) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState("");
  const [resposta, setResposta] = useState<Retorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    campo.current?.focus();
  }, [resposta]);

  async function bipar(evento: React.FormEvent) {
    evento.preventDefault();
    const lido = codigo.trim();
    if (!lido || ocupado) return;

    setOcupado(true);
    setErro(null);
    setCodigo("");

    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.rpc(
      "confirmar_impressao_por_codigo",
      {
        p_pacote_id: pacoteId,
        p_codigo: lido,
        p_operador_id: operadorId,
      },
    );

    if (error) {
      setErro("Não foi possível registrar. Bipe de novo.");
      setOcupado(false);
      return;
    }

    const r = (Array.isArray(data) ? data[0] : data) as Retorno;
    setResposta(r);
    setOcupado(false);

    // Confirmou: a tela do servidor precisa refletir o novo estado.
    if (r.ok) router.refresh();
  }

  return (
    <div className="border-t border-linha px-4 py-[14px]">
      <form onSubmit={bipar}>
        <label
          htmlFor="conf-etiqueta"
          className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
        >
          Bipe a etiqueta impressa
        </label>
        <input
          ref={campo}
          id="conf-etiqueta"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          placeholder="bipe aqui o papel que saiu"
          className="w-full rounded-[10px] border-2 border-linha bg-superficie px-4 py-[14px] font-mono text-[18px] outline-none focus-visible:border-tinta"
        />
        <p className="m-0 mt-2 text-[12px] text-suave">
          O sistema sabe que mandou imprimir, não que saiu papel. Papel
          acabado ou etiqueta em branco só aparecem aqui.
        </p>
      </form>

      {erro && (
        <p
          role="alert"
          className="m-0 mt-3 rounded-lg border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico"
        >
          {erro}
        </p>
      )}

      {resposta && !resposta.ok && (
        <p
          role="alert"
          className="m-0 mt-3 rounded-lg border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico"
        >
          {mensagem(resposta.motivo)}
        </p>
      )}
    </div>
  );
}

function mensagem(motivo: string) {
  if (motivo.startsWith("etiqueta_de_outro_pacote:")) {
    return `Esta etiqueta é do pedido ${motivo.slice("etiqueta_de_outro_pacote:".length)}. Confira se a caixa certa está na sua frente.`;
  }

  const texto: Record<string, string> = {
    codigo_desconhecido:
      "Nenhum pacote do sistema tem este código. Confira se é mesmo a etiqueta de envio.",
    ainda_na_fila:
      "A etiqueta ainda não saiu da impressora. Espere o agente imprimir.",
    ja_confirmada: "Esta etiqueta já foi confirmada.",
    nada_foi_impresso:
      "Nada foi impresso para este pacote ainda — ou a última tentativa falhou.",
    codigo_vazio: "Nada foi lido. Bipe de novo.",
  };

  return texto[motivo] ?? "Não foi possível confirmar.";
}
