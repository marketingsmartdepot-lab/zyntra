import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { permissoesDeAgora } from "@/lib/permissoes";

/**
 * A etiqueta em PDF, para ver na tela.
 *
 * Quem confere numa máquina sem impressora precisa olhar a etiqueta — o ZPL
 * é comando para a Zebra, ninguém lê. O PDF já está guardado desde que a
 * etiqueta foi obtida do Mercado Livre, então aqui não há ida à rede: é só
 * entregar o que está no banco.
 *
 * `inline` de propósito: abre no visualizador do navegador, onde dá para
 * imprimir escolhendo a impressora. Como baixar arquivo, seria mais um passo.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("Entre no ZYNTRA para ver a etiqueta.", { status: 401 });
  }

  // Esta URL não passa pela casca do sistema, então a trava da Expedição tem
  // de estar aqui também: um link de etiqueta colado no WhatsApp continua
  // sendo uma porta.
  const pode = await permissoesDeAgora();
  if (!pode.has("ver_expedicao")) {
    return new NextResponse("Sem permissão de ver a Expedição.", { status: 403 });
  }

  const { data } = await supabase
    .from("pacotes")
    .select("envios ( ref_externa, etiqueta_pdf )")
    .eq("id", id)
    .maybeSingle();

  const envio = (data as unknown as {
    envios: { ref_externa: string; etiqueta_pdf: string | null } | null;
  } | null)?.envios;

  if (!envio?.etiqueta_pdf) {
    return new NextResponse(
      "Esta caixa ainda não tem etiqueta. O Mercado Livre só entrega quando o envio está pronto para imprimir.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const bytes = Buffer.from(envio.etiqueta_pdf, "base64");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiqueta-${envio.ref_externa}.pdf"`,
      // Etiqueta não muda depois de obtida, mas também não é para ficar em
      // cache compartilhado: é documento de um pedido.
      "Cache-Control": "private, max-age=600",
    },
  });
}
