import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Onde o Mercado Livre avisa que algo mudou.
 *
 * Pública por obrigação: o ML não tem login no ZYNTRA. O que faz as vezes de
 * porta é o `application_id` no corpo, conferido dentro do banco — e o fato de
 * a função do outro lado só saber inserir, nunca ler.
 *
 * Responde 200 SEMPRE, inclusive quando descarta. O ML reenvia enquanto não
 * receber 200 e depois desiste de vez; devolver erro para um aviso que não
 * interessa faria o ML insistir à toa e, no limite, parar de avisar.
 *
 * E responde rápido: nada de buscar o recurso aqui. O aviso é guardado cru e
 * processado depois — o ML tem paciência curta, e uma ida ao /orders no meio
 * do caminho transformaria venda em aviso perdido.
 */
export async function POST(request: NextRequest) {
  let corpo: unknown;

  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    // Cliente sem sessão de propósito: quem chama é o Mercado Livre, e a
    // função do banco é que decide se aquilo entra.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );

    await supabase.rpc("receber_aviso_ml", { p_corpo: corpo });
  } catch {
    // Guardar falhou. Ainda assim 200: o reenvio do ML cairia no mesmo erro, e
    // a falha aparece do lado de cá, nos avisos que não chegaram.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** O ML às vezes confere o endereço com um GET antes de usar. */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
