import { Assinatura, Logotipo, Rodape, SimboloZ } from "@/components/marca";
import { FormularioEntrada } from "./formulario";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Entrar — ZYNTRA" };

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string; porta?: string }>;
}) {
  const { destino, porta } = await searchParams;

  // Quem entra por PIN precisa achar o próprio nome. A lista vem do banco com
  // só id e nome, e só de quem tem PIN — a tela de entrada é pública, então
  // leva o mínimo.
  const supabase = await criarClienteServidor();
  const { data: operadores } = await supabase.rpc("operadores_da_porta");
  const paraOnde =
    destino && destino.startsWith("/") && !destino.startsWith("//")
      ? destino
      : "/expedicao";

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-grafite text-offwhite">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1400 846"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g stroke="#D7BF96" strokeOpacity={0.07} strokeWidth={1.5}>
          <path d="M1180 0L180 846" />
          <path d="M1400 0L400 846" />
          <path d="M1620 0L620 846" />
          <path d="M1840 0L840 846" />
          <path d="M2060 0L1060 846" />
        </g>
      </svg>

      <div className="relative flex flex-1 items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center gap-14 lg:flex-row lg:items-center lg:gap-[84px]">
          <div className="w-full max-w-[412px]">
            <SimboloZ className="mb-7 block h-[62px] w-[62px]" />
            <Logotipo className="block h-[52px] w-auto text-offwhite" />
            <Assinatura className="mt-[26px]" />
          </div>

          <FormularioEntrada
            destino={paraOnde}
            operadores={(operadores ?? []) as { id: string; nome: string }[]}
            porta={porta}
          />
        </div>
      </div>

      <Rodape className="relative border-t border-grafite-linha px-6 py-[14px]" />
    </main>
  );
}
