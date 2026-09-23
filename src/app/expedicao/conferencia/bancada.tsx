"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { concluirConferencia } from "./acoes";

export type ItemConferido = {
  sku_id: string;
  codigo: string;
  descricao: string;
  quantidade_esperada: number;
  quantidade_lida: number;
  eh_kit: boolean;
};

type Retorno = {
  resultado: "ok" | "nao_pertence" | "excedente" | "desconhecido";
  sku: string | null;
  descricao: string | null;
  lidas: number;
  esperadas: number;
  faltam: number;
  repetida: boolean;
};

const MENSAGEM: Record<Retorno["resultado"], { titulo: string; tom: Tom }> = {
  ok: { titulo: "Leitura correta", tom: "ok" },
  nao_pertence: { titulo: "Item não pertence a este pacote", tom: "critico" },
  excedente: { titulo: "Unidade excedente", tom: "critico" },
  desconhecido: { titulo: "Código não cadastrado", tom: "atencao" },
};

type Tom = "ok" | "critico" | "atencao";

export function Bancada({
  conferenciaId,
  itensIniciais,
  proximoPacote,
}: {
  conferenciaId: string;
  itensIniciais: ItemConferido[];
  proximoPacote: string | null;
}) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [itens, setItens] = useState(itensIniciais);
  const [codigo, setCodigo] = useState("");
  const [ultima, setUltima] = useState<Retorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [finalizando, iniciarFinalizacao] = useTransition();

  // O campo de leitura fica sempre ativo: o operador está com o leitor na mão,
  // não com o mouse.
  useEffect(() => {
    campo.current?.focus();
  }, [ultima, itens]);

  const lidas = itens.reduce((t, i) => t + i.quantidade_lida, 0);
  const esperadas = itens.reduce((t, i) => t + i.quantidade_esperada, 0);
  const faltam = esperadas - lidas;
  const completo = faltam <= 0 && esperadas > 0;

  async function bipar(evento: React.FormEvent) {
    evento.preventDefault();
    const lido = codigo.trim();
    if (!lido || ocupado) return;

    setOcupado(true);
    setErro(null);
    setCodigo("");

    // Chave de idempotência: se a rede cair e a leitura for reenviada, ela
    // traz a mesma chave e não conta de novo.
    const chave = crypto.randomUUID();
    const supabase = criarClienteNavegador();

    let tentativa = 0;
    while (tentativa < 2) {
      const { data, error } = await supabase.rpc("registrar_leitura", {
        p_conferencia_id: conferenciaId,
        p_codigo: lido,
        p_chave_cliente: chave,
      });

      if (!error) {
        const r = (Array.isArray(data) ? data[0] : data) as Retorno;
        setUltima(r);
        if (r.resultado === "ok" && r.sku) {
          setItens((atual) =>
            atual.map((i) =>
              i.sku_id === r.sku ? { ...i, quantidade_lida: r.lidas } : i,
            ),
          );
        }
        setOcupado(false);
        return;
      }

      tentativa += 1;
      if (tentativa >= 2) {
        setErro(
          "Não foi possível registrar a leitura. Bipe de novo — a leitura anterior não foi contada.",
        );
        setOcupado(false);
        return;
      }
    }
  }

  function finalizar() {
    iniciarFinalizacao(async () => {
      const r = await concluirConferencia(conferenciaId);
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      router.replace(
        proximoPacote
          ? `/expedicao?etapa=conferir&pacote=${proximoPacote}`
          : "/expedicao?etapa=conferir",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <form onSubmit={bipar} className="flex items-center gap-3 px-6 pb-4">
        <div className="flex flex-1 items-center gap-3 rounded-[10px] border-2 border-tinta bg-superficie px-[14px] py-[11px]">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5v14M6.5 5v14M10 5v10M13.5 5v14M17 5v10M20.5 5v14" />
          </svg>
          <label htmlFor="bipe" className="sr-only">
            Conferência: insira o EAN ou bipe o produto
          </label>
          <input
            id="bipe"
            ref={campo}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="off"
            placeholder="Insira o EAN ou bipe o produto"
            className="w-full border-0 bg-transparent font-mono text-[19px] font-medium outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-[#B9B5A9]"
          />
        </div>
        <button type="submit" className="sr-only">
          Registrar leitura
        </button>
      </form>

      {erro && (
        <p
          role="alert"
          className="mx-6 mb-4 rounded-lg border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico"
        >
          {erro}
        </p>
      )}

      {ultima && <Retorno1 retorno={ultima} />}

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["SKU", "Descrição", "Qtde", "Lido", "Situação"].map((c, i) => (
              <th
                key={c}
                style={i === 2 || i === 3 ? { width: "96px" } : undefined}
                className="border-b border-linha px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => {
            const pronto = i.quantidade_lida >= i.quantidade_esperada;
            return (
              <tr key={i.sku_id}>
                <td className="border-b border-linha-suave px-4 py-3 font-mono text-[13px] font-semibold">
                  {i.codigo}
                </td>
                <td className="border-b border-linha-suave px-4 py-3">
                  <span className="text-[13.5px] font-medium">
                    {i.descricao}
                  </span>
                  {i.eh_kit && (
                    <div className="mt-[2px] text-[11.5px] text-suave">
                      kit — a venda vale mais de uma unidade na caixa
                    </div>
                  )}
                </td>
                <td className="border-b border-linha-suave px-4 py-3 font-mono text-[22px] font-semibold tabular-nums">
                  {i.quantidade_esperada}
                </td>
                <td
                  className={`border-b border-linha-suave px-4 py-3 font-mono text-[22px] font-semibold tabular-nums ${
                    pronto ? "" : "text-suave"
                  }`}
                >
                  {i.quantidade_lida}
                </td>
                <td className="border-b border-linha-suave px-4 py-3">
                  {pronto ? (
                    <Selo tom="ok">Completo</Selo>
                  ) : (
                    <Selo tom="neutro">
                      faltam {i.quantidade_esperada - i.quantidade_lida}
                    </Selo>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-linha bg-fundo px-6 py-4">
        <span className="text-[12.5px] text-suave">
          <b className="font-semibold text-tinta">{lidas}</b> de{" "}
          <b className="font-semibold text-tinta">{esperadas}</b> unidades lidas
          {" · "}
          <b className="font-semibold text-tinta">impressão bloqueada</b> até
          fechar a conferência
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={finalizar}
          disabled={!completo || finalizando}
          className={`rounded-[10px] px-[22px] py-[14px] text-[15px] font-semibold ${
            completo
              ? "bg-tinta text-white"
              : "cursor-not-allowed bg-[#DEDAD0] text-[#8C8880]"
          }`}
        >
          {finalizando ? "Finalizando…" : "Finalizar e próximo"}
          {!completo && (
            <span className="block text-[11.5px] font-medium">
              faltam {faltam} {faltam === 1 ? "unidade" : "unidades"}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

function Retorno1({ retorno }: { retorno: Retorno }) {
  const m = MENSAGEM[retorno.resultado];
  const cor =
    m.tom === "ok"
      ? "border-ok-linha bg-ok-bg text-ok"
      : m.tom === "critico"
        ? "border-critico-linha bg-critico-bg text-critico"
        : "border-atencao-linha bg-atencao-bg text-atencao";

  return (
    <div
      role="status"
      className={`mx-6 mb-4 flex items-center gap-4 rounded-[9px] border px-4 py-3 ${cor}`}
    >
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
          {m.titulo}
          {retorno.repetida && " · leitura repetida, não contada de novo"}
        </div>
        <div className="mt-[2px] text-[14.5px] font-semibold text-tinta">
          {retorno.descricao ?? "Produto não identificado"}
        </div>
      </div>
      <span className="flex-1" />
      {retorno.resultado !== "desconhecido" && (
        <span className="font-mono text-[22px] font-semibold tabular-nums">
          {retorno.lidas}/{retorno.esperadas}
        </span>
      )}
    </div>
  );
}

function Selo({
  tom,
  children,
}: {
  tom: "ok" | "neutro";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold ${
        tom === "ok"
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-linha text-suave"
      }`}
    >
      {children}
    </span>
  );
}
