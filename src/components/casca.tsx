import Link from "next/link";
import { Logotipo, Rodape, SimboloZ } from "@/components/marca";

export type Frente = "expedicao" | "logistica" | "integracao";

const FRENTES: { chave: Frente; rotulo: string; href: string }[] = [
  { chave: "expedicao", rotulo: "Expedição", href: "/expedicao" },
  { chave: "logistica", rotulo: "Logística", href: "/logistica" },
  { chave: "integracao", rotulo: "Integração", href: "/integracao" },
];

export function Casca({
  frente,
  email,
  children,
}: {
  frente: Frente;
  email: string;
  children: React.ReactNode;
}) {
  const iniciais =
    email
      .split("@")[0]
      .split(/[.\-_]/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="flex h-[58px] shrink-0 items-center gap-4 bg-grafite px-5 text-offwhite">
        <span className="flex items-center gap-[11px]">
          <SimboloZ className="block h-[25px] w-[25px]" />
          <Logotipo className="block h-[14px] w-auto text-offwhite" />
        </span>

        <nav
          aria-label="Frente"
          className="flex gap-[2px] rounded-lg border border-grafite-linha bg-[#19252A] p-[2px]"
        >
          {FRENTES.map((f) => (
            <Link
              key={f.chave}
              href={f.href}
              aria-current={f.chave === frente ? "page" : undefined}
              className={`rounded-md px-[13px] py-[5px] text-[12.5px] font-semibold ${
                f.chave === frente
                  ? "bg-champanhe text-grafite"
                  : "text-cinza-2 hover:text-offwhite"
              }`}
            >
              {f.rotulo}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />

        <span className="flex items-center gap-[9px]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2A3A40] text-[11px] font-bold text-champanhe">
            {iniciais}
          </span>
          <span className="text-[12.5px] font-semibold">{email}</span>
        </span>

        <form action="/auth/sair" method="post">
          <button
            type="submit"
            className="rounded-md border border-grafite-linha px-3 py-[6px] text-[12px] font-semibold text-cinza-2 hover:text-offwhite"
          >
            Sair
          </button>
        </form>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>

      <Rodape className="shrink-0 border-t border-grafite-linha bg-grafite px-5 py-[10px]" />
    </div>
  );
}

export function Abas({
  itens,
  ativa,
}: {
  itens: { rotulo: string; contagem?: string; tom?: "critico" | "atencao" }[];
  ativa: string;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-[30px] border-b border-linha bg-superficie px-5">
      {itens.map((i) => {
        const atual = i.rotulo === ativa;
        return (
          <span
            key={i.rotulo}
            className={`flex flex-col gap-[2px] border-b-[3px] py-[13px] pb-[14px] ${
              atual ? "border-tinta text-tinta" : "border-transparent text-suave"
            }`}
          >
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
              {i.rotulo}
            </span>
            <span
              className={`text-[25px] font-bold leading-none tracking-[-0.02em] ${
                i.tom === "critico"
                  ? "text-critico"
                  : i.tom === "atencao"
                    ? "text-atencao"
                    : atual
                      ? "text-tinta"
                      : "text-[#43464D]"
              }`}
            >
              {i.contagem ?? "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}
