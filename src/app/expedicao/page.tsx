import { redirect } from "next/navigation";
import { Abas, Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Expedição — ZYNTRA" };

const ABAS = [
  { rotulo: "Aberto", tom: "critico" as const },
  { rotulo: "Faturado", tom: "atencao" as const },
  { rotulo: "Separar" },
  { rotulo: "Lista de separação" },
  { rotulo: "Conferir" },
  { rotulo: "Pronto pra envio" },
  { rotulo: "Retidos", tom: "atencao" as const },
];

export default async function PaginaExpedicao() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/entrar?destino=/expedicao");

  return (
    <Casca frente="expedicao" email={user.email ?? "sem e-mail"}>
      <Abas itens={ABAS} ativa="Separar" />

      <div className="flex flex-1 items-center justify-center bg-superficie px-6 py-20">
        <div className="max-w-[46ch] text-center">
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">
            Nenhuma conta conectada
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-suave">
            A esteira fica vazia até a primeira conta do Mercado Livre ser
            ligada na Integração. Nada aqui é dado de exemplo — o que não
            existe, não aparece.
          </p>
          <a
            href="/integracao"
            className="mt-6 inline-block rounded-lg bg-tinta px-4 py-[10px] text-[13px] font-semibold text-white"
          >
            Ir para Integração
          </a>
        </div>
      </div>
    </Casca>
  );
}
