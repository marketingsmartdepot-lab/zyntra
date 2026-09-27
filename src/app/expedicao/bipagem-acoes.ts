"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { iniciarConferencia } from "./conferencia/acoes";

const COOKIE = "zyntra_modo_bipagem";

/**
 * O modo fica ligado na MÁQUINA, não na pessoa: é a bancada que bipa.
 *
 * O parâmetro da URL manda mais que o cookie, e é por uma razão chata: quando
 * um Server Action grava cookie E redireciona, o Next desenha o destino ainda
 * dentro da mesma resposta, onde `cookies()` é o do pedido ANTERIOR. Sem o
 * parâmetro, clicar em "Ligar" gravava certo e devolvia a tela velha.
 *
 * O cookie continua valendo para tudo que vem depois — abrir um pedido, voltar
 * para a lista, recarregar a aba.
 */
export async function modoBipagemLigado(daUrl?: string) {
  if (daUrl === "1") return true;
  if (daUrl === "0") return false;
  return (await cookies()).get(COOKIE)?.value === "1";
}

export async function alternarModoBipagem(formData: FormData) {
  const ligar = String(formData.get("ligar") ?? "") === "1";
  const jar = await cookies();

  if (ligar) {
    jar.set(COOKIE, "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    jar.delete(COOKIE);
  }

  revalidatePath("/expedicao");
  redirect(`/expedicao?etapa=conferir&bipagem=${ligar ? "1" : "0"}`);
}

/**
 * Bipou um produto sem escolher pedido nenhum: acha o pedido.
 *
 * Um candidato só, abre. Nenhum, avisa. Mais de um, mostra os que são e deixa
 * a pessoa apontar — abrir a caixa errada custa mais caro do que um clique.
 */
export async function acharPedido(formData: FormData) {
  const codigo = String(formData.get("codigo") ?? "").trim();
  if (!codigo) redirect("/expedicao?etapa=conferir");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("achar_pacote_por_codigo", {
    p_codigo: codigo,
  });

  if (error) {
    redirect(
      `/expedicao?etapa=conferir&bipagem=1&bipe=erro&codigo=${encodeURIComponent(codigo)}`,
    );
  }

  const achados = (data ?? []) as { pacote_id: string }[];

  if (achados.length === 0) {
    redirect(
      `/expedicao?etapa=conferir&bipagem=1&bipe=nenhum&codigo=${encodeURIComponent(codigo)}`,
    );
  }

  if (achados.length === 1) {
    // Bipou, achou: já abre a bancada, sem o clique do meio. O produto
    // bipado NÃO conta como lido — achar o pedido e provar que a peça está
    // na caixa são coisas diferentes, e ela escolheu manter as duas.
    //
    // Se abrir falhar (máquina sem bancada escolhida, por exemplo), o pedido
    // abre mesmo assim e o botão "Abrir a bancada" aparece como antes: é
    // melhor um clique a mais do que uma tela de erro com a caixa na mão.
    await iniciarConferencia(achados[0].pacote_id);
    redirect(`/expedicao?etapa=conferir&pacote=${achados[0].pacote_id}`);
  }

  redirect(
    `/expedicao?etapa=conferir&bipagem=1&bipe=varios&codigo=${encodeURIComponent(codigo)}`,
  );
}
