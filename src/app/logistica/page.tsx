import { redirect } from "next/navigation";
import { Casca } from "@/components/casca";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Logística — ZYNTRA" };

export default async function PaginaLogistica() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?destino=/logistica");

  return (
    <Casca frente="logistica" email={user.email ?? "sem e-mail"}>
      <div className="flex flex-1 items-center justify-center bg-superficie px-6 py-20">
        <div className="max-w-[52ch] text-center">
          <h1 className="text-[20px] font-bold tracking-[-0.02em]">
            A doca ainda não recebe nada
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-suave">
            A Logística começa onde a Expedição termina: só aparece aqui o que
            for entregue na doca depois de conferido e lacrado. Enquanto a
            esteira não roda, não há saída para registrar nem etiqueta Flex para
            contar.
          </p>
        </div>
      </div>
    </Casca>
  );
}
