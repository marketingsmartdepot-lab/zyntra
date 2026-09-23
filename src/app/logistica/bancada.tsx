"use client";

import { useEffect, useRef, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { moeda } from "./formato";

type Retorno = {
  ok: boolean;
  motivo: string;
  custo: string | number | null;
  pacote_id: string | null;
  codigo: string | null;
};

type Linha = {
  codigo: string;
  custo: number;
  em: string;
};

/**
 * A segunda bipagem: contra a relação que sai pela porta.
 *
 * É aqui que o custo da etiqueta é congelado — um por pacote, no instante do
 * bipe. Não na doca, não no fim do mês: se a tabela do Flex mudar amanhã, o
 * que já saiu continua valendo o que valia quando saiu.
 *
 * Bipar o mesmo pacote de novo é normal (o operador se perde na pilha) e não
 * conta duas vezes. Quem garante isso é o banco, não esta tela.
 */
export function BancadaDeSaida({
  saidaId,
  codigo,
  modalidade,
  jaBipados,
  totalInicial,
  aindaNaDoca,
  operadorId,
}: {
  saidaId: string;
  codigo: string;
  modalidade: string;
  jaBipados: number;
  totalInicial: number;
  aindaNaDoca: number;
  /** Quem está em turno. Cada bipe fica no nome dele. */
  operadorId: string | null;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [lido, setLido] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [ultima, setUltima] = useState<Retorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // O operador está com o leitor na mão, não com o mouse.
  useEffect(() => {
    campo.current?.focus();
  }, [ultima, linhas]);

  const bipadosAgora = linhas.length;
  const total = totalInicial + linhas.reduce((t, l) => t + l.custo, 0);
  const faltam = Math.max(0, aindaNaDoca - bipadosAgora);

  async function bipar(evento: React.FormEvent) {
    evento.preventDefault();
    const valor = lido.trim();
    if (!valor || ocupado) return;

    setOcupado(true);
    setErro(null);
    setLido("");

    const supabase = criarClienteNavegador();
    const { data, error } = await supabase.rpc("bipar_saida_por_codigo", {
      p_saida_id: saidaId,
      p_codigo: valor,
      p_operador_id: operadorId,
    });

    if (error) {
      setErro(
        "Não foi possível registrar. Bipe de novo — este pacote não foi contado.",
      );
      setOcupado(false);
      return;
    }

    const r = (Array.isArray(data) ? data[0] : data) as Retorno;
    setUltima(r);

    // Só entra na lista o que de fato passou a contar agora. `ja_bipado` é
    // acerto do operador, não um pacote novo.
    if (r.ok && r.motivo === "ok") {
      setLinhas((atual) => [
        {
          codigo: r.codigo ?? valor,
          custo: Number(r.custo ?? 0),
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
        <span className="rounded-full border border-linha px-[9px] py-[3px] text-[11.5px] font-semibold text-suave">
          {modalidade}
        </span>
        <span className="flex-1" />
        <span className="text-[12.5px] text-suave">
          Bipe a etiqueta de cada pacote que entrar no carro.
        </span>
      </div>

      <form onSubmit={bipar}>
        <label
          htmlFor="saida-codigo"
          className="mb-2 block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
        >
          Etiqueta
        </label>
        <input
          ref={campo}
          id="saida-codigo"
          name="codigo"
          value={lido}
          onChange={(e) => setLido(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          placeholder="bipe aqui"
          className="w-full rounded-[10px] border-2 border-linha bg-superficie px-4 py-[18px] font-mono text-[22px] tracking-[-0.01em] outline-none focus-visible:border-tinta"
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
        <Tile rotulo="Bipados nesta saída" valor={String(jaBipados + bipadosAgora)} />
        <Tile
          rotulo="Ainda na doca"
          valor={String(faltam)}
          nota={faltam > 0 ? "esperando bipe" : "nada pendente"}
        />
        <Tile
          rotulo="Acumulado"
          valor={moeda(total)}
          destaque
          nota="congelado no instante do bipe"
        />
      </div>

      {linhas.length > 0 && (
        <section>
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Nesta sessão
          </h3>
          <div className="flex flex-col gap-1">
            {linhas.map((l, i) => (
              <div
                key={`${l.codigo}-${i}`}
                className="flex items-center gap-4 rounded-lg border border-linha px-4 py-[9px] text-[12.5px]"
              >
                <span className="font-mono font-semibold">{l.codigo}</span>
                <span className="text-suave">{l.em}</span>
                <span className="flex-1" />
                <span className="font-mono font-semibold tabular-nums">
                  {l.custo > 0 ? moeda(l.custo) : "sem custo"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Cada recusa diz o que fazer. "Não foi possível" faz o operador bipar de novo
 * achando que o leitor falhou — e a fila para atrás dele.
 */
function Resposta({ retorno }: { retorno: Retorno }) {
  const { titulo, detalhe, tom } = ler(retorno);

  const cor =
    tom === "ok"
      ? "border-ok-linha bg-ok-bg text-ok"
      : tom === "atencao"
        ? "border-atencao-linha bg-atencao-bg text-atencao"
        : "border-critico-linha bg-critico-bg text-critico";

  return (
    <div
      role="status"
      className={`rounded-[10px] border px-4 py-[14px] ${cor}`}
    >
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
    const custo = Number(r.custo ?? 0);
    return {
      titulo: "Registrado",
      detalhe:
        custo > 0
          ? `${r.codigo} · ${moeda(custo)} de etiqueta`
          : `${r.codigo} · esta modalidade não tem custo`,
      tom: "ok",
    };
  }

  if (r.motivo === "ja_bipado") {
    return {
      titulo: "Já estava nesta saída",
      detalhe: "Não foi contado de novo. Pode seguir.",
      tom: "atencao",
    };
  }

  if (r.motivo.startsWith("outra_modalidade:")) {
    return {
      titulo: "Este pacote é de outro destino",
      detalhe: `Ele vai em ${r.motivo.slice("outra_modalidade:".length)}. Separe da pilha.`,
      tom: "critico",
    };
  }

  if (r.motivo.startsWith("ja_saiu_em_")) {
    return {
      titulo: "Este pacote já saiu",
      detalhe: `Foi na relação ${r.motivo.slice("ja_saiu_em_".length)}. Não pode sair duas vezes.`,
      tom: "critico",
    };
  }

  const texto: Record<string, { titulo: string; detalhe: string }> = {
    codigo_desconhecido: {
      titulo: "Etiqueta não reconhecida",
      detalhe: "Nenhum pacote do sistema tem este código.",
    },
    pacote_nao_esta_pronto: {
      titulo: "Pacote não está pronto",
      detalhe: "Ele ainda não passou pela conferência.",
    },
    pacote_nao_entregue_na_doca: {
      titulo: "Pacote não passou pela doca",
      detalhe: "Registre a entrega na doca antes de despachar.",
    },
    saida_nao_aberta: {
      titulo: "Esta saída está fechada",
      detalhe: "Abra outra relação para continuar.",
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
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`min-w-[170px] flex-1 rounded-[10px] border p-4 ${
        destaque ? "border-tinta bg-tinta text-white" : "border-linha"
      }`}
    >
      <div
        className={`text-[10.5px] font-semibold uppercase tracking-[0.13em] ${
          destaque ? "text-[#A9AEB6]" : "text-suave"
        }`}
      >
        {rotulo}
      </div>
      <div className="mt-[5px] font-mono text-[28px] font-semibold tracking-[-0.03em] tabular-nums">
        {valor}
      </div>
      {nota && (
        <div
          className={`mt-1 text-[11.5px] ${destaque ? "text-[#A9AEB6]" : "text-suave"}`}
        >
          {nota}
        </div>
      )}
    </div>
  );
}
