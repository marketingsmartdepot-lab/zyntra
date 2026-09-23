"use client";

import { useState } from "react";
import Link from "next/link";
import { Logotipo, SimboloZ } from "@/components/marca";

export type Frente = "expedicao" | "logistica" | "integracao" | "painel";

const FRENTES: { chave: Frente; rotulo: string; href: string }[] = [
  { chave: "painel", rotulo: "Painel", href: "/painel" },
  { chave: "expedicao", rotulo: "Expedição", href: "/expedicao" },
  { chave: "logistica", rotulo: "Logística", href: "/logistica" },
  { chave: "integracao", rotulo: "Integração", href: "/integracao" },
];

export function Lateral({
  frente,
  email,
  recolhidaInicial,
  bancada,
}: {
  frente: Frente;
  email: string;
  recolhidaInicial: boolean;
  /** Qual bancada é esta máquina. `null` quando ainda não foi escolhida. */
  bancada?: string | null;
}) {
  const [recolhida, setRecolhida] = useState(recolhidaInicial);

  function alternar() {
    const nova = !recolhida;
    setRecolhida(nova);
    // Cookie e não localStorage: assim o servidor já renderiza no estado
    // certo na próxima navegação, sem piscar.
    try {
      document.cookie = `zyntra_lateral=${nova ? "recolhida" : "aberta"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Navegador bloqueando cookie: a escolha vale só nesta sessão.
    }
  }

  const iniciais =
    email
      .split("@")[0]
      .split(/[.\-_]/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <aside
      className={`flex shrink-0 flex-col bg-grafite text-offwhite transition-[width] duration-150 ${
        recolhida ? "w-[64px]" : "w-[196px]"
      }`}
    >
      <div
        className={`flex h-[58px] shrink-0 items-center ${
          recolhida ? "justify-center px-0" : "gap-[11px] px-4"
        }`}
      >
        <SimboloZ className="block h-[25px] w-[25px] shrink-0" />
        {!recolhida && (
          <Logotipo className="block h-[13px] w-auto text-offwhite" />
        )}
      </div>

      <nav aria-label="Frente" className="flex flex-col gap-1 px-[10px] py-3">
        {FRENTES.map((f) => {
          const ativa = f.chave === frente;
          return (
            <Link
              key={f.chave}
              href={f.href}
              aria-current={ativa ? "page" : undefined}
              title={recolhida ? f.rotulo : undefined}
              className={`flex items-center gap-[10px] rounded-lg py-[9px] text-[13px] font-semibold no-underline ${
                recolhida ? "justify-center px-0" : "px-3"
              } ${
                ativa
                  ? "bg-champanhe text-grafite"
                  : "text-cinza-2 hover:bg-[#19252A] hover:text-offwhite"
              }`}
            >
              <Icone frente={f.chave} />
              {!recolhida && <span>{f.rotulo}</span>}
            </Link>
          );
        })}
      </nav>

      <span className="flex-1" />

      {/*
        Sem bancada escolhida a impressão não tem para onde ir, então o aviso
        fica em vermelho — é falta de configuração, não detalhe.
      */}
      <Link
        href="/bancada"
        title={bancada ? `Esta máquina é a ${bancada}` : "Escolher a bancada"}
        className={`mx-[10px] mb-2 flex items-center gap-[10px] rounded-lg border px-3 py-[9px] no-underline ${
          recolhida ? "justify-center px-0" : ""
        } ${
          bancada
            ? "border-grafite-linha text-cinza-2 hover:text-offwhite"
            : "border-critico/50 bg-critico/10 text-[#F0B8B0]"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M6 9V4h12v5" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <path d="M6 14h12v7H6z" />
        </svg>
        {!recolhida && (
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="block text-[9.5px] font-semibold uppercase tracking-[0.13em] opacity-70">
              Esta bancada
            </span>
            <span className="block truncate text-[12px] font-semibold">
              {bancada ?? "não escolhida"}
            </span>
          </span>
        )}
      </Link>

      <div className="border-t border-grafite-linha px-[10px] py-3">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={!recolhida}
          title={recolhida ? "Expandir menu" : "Recolher menu"}
          className={`mb-2 flex w-full items-center gap-[10px] rounded-lg py-[7px] text-[12px] font-semibold text-cinza-2 hover:text-offwhite ${
            recolhida ? "justify-center px-0" : "px-3"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={recolhida ? "rotate-180" : undefined}
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
          {!recolhida && <span>Recolher</span>}
        </button>

        <div
          className={`flex items-center gap-[9px] ${recolhida ? "justify-center" : ""}`}
        >
          <span
            title={email}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2A3A40] text-[11px] font-bold text-champanhe"
          >
            {iniciais}
          </span>
          {!recolhida && (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-cinza-2">
              {email}
            </span>
          )}
        </div>

        <form action="/auth/sair" method="post" className="mt-2">
          <button
            type="submit"
            title={recolhida ? "Sair" : undefined}
            className={`flex w-full items-center gap-[10px] rounded-lg border border-grafite-linha py-[7px] text-[12px] font-semibold text-cinza-2 hover:text-offwhite ${
              recolhida ? "justify-center px-0" : "px-3"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            {!recolhida && <span>Sair</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}

function Icone({ frente }: { frente: Frente }) {
  const comum = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "shrink-0",
  };

  if (frente === "painel") {
    return (
      <svg {...comum}>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 5-7" />
      </svg>
    );
  }
  if (frente === "expedicao") {
    return (
      <svg {...comum}>
        <path d="M21 8 12 3 3 8l9 5 9-5Z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </svg>
    );
  }
  if (frente === "logistica") {
    return (
      <svg {...comum}>
        <path d="M3 6h11v10H3z" />
        <path d="M14 9h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="1.8" />
        <circle cx="17.5" cy="18" r="1.8" />
      </svg>
    );
  }
  return (
    <svg {...comum}>
      <path d="M9 7V4h6v3" />
      <path d="M7 7h10v5a5 5 0 0 1-10 0z" />
      <path d="M12 17v4" />
    </svg>
  );
}
