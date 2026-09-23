"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Retorno = {
  ok: boolean;
  motivo: string;
  pacote_id: string | null;
  codigo: string | null;
};

/**
 * A primeira bipagem: a caixa sai da expedição e vai para a doca.
 *
 * Aqui é onde a confirmação de impressão ganha dente. Caixa que precisa de
 * etiqueta e não teve a etiqueta bipada na mão é recusada — é a última chance
 * de pegar uma caixa sem etiqueta antes de ela chegar no transportador.
 *
 * O carrinho pode ser misto: a doca se organiza sozinha por destino.
 */
export function BancadaDoca({
  entregaId,
  codigo,
  entreguePor,
  jaBipados,
}: {
  entregaId: string;
  codigo: string;
  entreguePor: string;
  jaBipados: number;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [lido, setLido] = useState("");
  const [linhas, setLinhas] = useState<{ codigo: string; em: string }[]>([]);
  const [ultima, setUltima] = useState<Retorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    campo.current?.focus();
  }, [ultima, linhas]);

  async function bipar(evento: React.FormEvent) {
    evento.preventDefault();
    const valor = lido.trim();
    if (!valor || ocupado) return;

    setOcupado(true);
    setErro(null);
    setLido("");

    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.rpc("bipar_entrega_doca", {
      p_entrega_id: entregaId,
      p_codigo: valor,
    });

    if (error) {
      setErro("Não foi possível registrar. Bipe de novo — não foi contado.");
      setOcupado(false);
      return;
    }

    const r = (Array.isArray(data) ? data[0] : data) as Retorno;
    setUltima(r);

    if (r.ok && r.motivo === "ok") {
      setLinhas((atual) => [
        {
          codigo: r.codigo ?? valor,
          em: new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          }),
        },
        ...atual,
      ]);
    }

    setOcupado(false);
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 font-mono text-[20px] font-bold tracking-[-0.02em]">
          {codigo}
        </h2>
        <span className="text-[12.5px] text-suave">
          levado por <b className="font-semibold text-tinta">{entreguePor}</b>
        </span>
        <span className="flex-1" />
        <Link
          href="/logistica?aba=doca"
          className="rounded-lg border border-linha px-3 py-[7px] text-[12.5px] font-semibold text-tinta no-underline"
        >
          Encerrar carrinho
        </Link>
      </div>

      <form onSubmit={bipar}>
        <label
          htmlFor="doca-codigo"
          className="mb-2 block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
        >
          Etiqueta da caixa
        </label>
        <input
          ref={campo}
          id="doca-codigo"
          value={lido}
          onChange={(e) => setLido(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          placeholder="bipe cada caixa que entrar no carrinho"
          className="w-full rounded-[10px] border-2 border-linha bg-superficie px-4 py-[18px] font-mono text-[22px] outline-none focus-visible:border-tinta"
        />
      </form>

      {erro && (
        <p
          role="alert"
          className="m-0 rounded-lg border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico"
        >
          {erro}
        </p>
      )}

      {ultima && <Resposta retorno={ultima} />}

      <div className="flex flex-wrap gap-3">
        <Tile
          rotulo="Nesta entrega"
          valor={String(jaBipados + linhas.length)}
          nota="caixas na doca"
        />
      </div>

      {linhas.length > 0 && (
        <section>
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Bipadas agora
          </h3>
          <div className="flex flex-col gap-1">
            {linhas.map((l, i) => (
              <div
                key={`${l.codigo}-${i}`}
                className="flex items-center gap-4 rounded-lg border border-linha px-4 py-[9px] text-[12.5px]"
              >
                <span className="font-mono font-semibold">{l.codigo}</span>
                <span className="flex-1" />
                <span className="text-suave">{l.em}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Resposta({ retorno }: { retorno: Retorno }) {
  const { titulo, detalhe, tom } = ler(retorno);

  const cor =
    tom === "ok"
      ? "border-ok-linha bg-ok-bg text-ok"
      : tom === "atencao"
        ? "border-atencao-linha bg-atencao-bg text-atencao"
        : "border-critico-linha bg-critico-bg text-critico";

  return (
    <div role="status" className={`rounded-[10px] border px-4 py-[14px] ${cor}`}>
      <p className="m-0 text-[16px] font-bold tracking-[-0.01em]">{titulo}</p>
      {detalhe && <p className="m-0 mt-1 text-[12.5px]">{detalhe}</p>}
    </div>
  );
}

function ler(r: Retorno): {
  titulo: string;
  detalhe: string | null;
  tom: "ok" | "atencao" | "critico";
} {
  if (r.motivo === "ok") {
    return { titulo: "Na doca", detalhe: r.codigo, tom: "ok" };
  }

  if (r.motivo === "ja_bipado") {
    return {
      titulo: "Já estava neste carrinho",
      detalhe: "Não foi contada de novo. Pode seguir.",
      tom: "atencao",
    };
  }

  if (r.motivo.startsWith("ja_na_doca_em_")) {
    return {
      titulo: "Esta caixa já está na doca",
      detalhe: `Foi na entrega ${r.motivo.slice("ja_na_doca_em_".length)}.`,
      tom: "atencao",
    };
  }

  const texto: Record<string, { titulo: string; detalhe: string }> = {
    etiqueta_nao_confirmada: {
      titulo: "Etiqueta não foi conferida na mão",
      detalhe:
        "Esta caixa precisa de etiqueta, e ninguém bipou o papel impresso. Volte para Expedição → Pronto e confirme antes de levar.",
    },
    ja_saiu_do_galpao: {
      titulo: "Esta caixa já saiu do galpão",
      detalhe:
        "Ou ela voltou depois de despachada, ou existe uma segunda etiqueta igual circulando. Chame o líder.",
    },
    pacote_nao_esta_pronto: {
      titulo: "Caixa ainda não está pronta",
      detalhe: "Ela não passou pela conferência.",
    },
    codigo_desconhecido: {
      titulo: "Etiqueta não reconhecida",
      detalhe: "Nenhum pacote do sistema tem este código.",
    },
    entrega_nao_encontrada: {
      titulo: "Este carrinho não existe mais",
      detalhe: "Abra outra entrega.",
    },
    codigo_vazio: { titulo: "Nada foi lido", detalhe: "Bipe de novo." },
  };

  const m = texto[r.motivo];
  return {
    titulo: m?.titulo ?? "Não foi possível registrar",
    detalhe: m?.detalhe ?? r.motivo,
    tom: "critico",
  };
}

function Tile({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="min-w-[170px] flex-1 rounded-[10px] border border-linha p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
        {rotulo}
      </div>
      <div className="mt-[5px] font-mono text-[28px] font-semibold tracking-[-0.03em] tabular-nums">
        {valor}
      </div>
      {nota && <div className="mt-1 text-[11.5px] text-suave">{nota}</div>}
    </div>
  );
}
