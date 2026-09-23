import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Rotas que podem ser abertas sem sessão. */
const PUBLICAS = ["/entrar", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Não colocar código entre criar o cliente e o getUser: a sessão precisa ser
  // renovada antes de qualquer decisão de rota, senão o usuário cai fora sozinho.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const caminho = request.nextUrl.pathname;
  const ehPublica = PUBLICAS.some((p) => caminho.startsWith(p));

  if (!user && !ehPublica) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("destino", caminho);
    return NextResponse.redirect(url);
  }

  if (user && caminho === "/entrar") {
    const url = request.nextUrl.clone();
    url.pathname = "/expedicao";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Tudo, menos estáticos e imagens.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
