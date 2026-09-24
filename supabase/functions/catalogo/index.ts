/**
 * Puxa o catálogo de produtos do Bling e casa com os SKUs daqui, pelo código.
 *
 * Esta função é só transporte: ela busca as páginas e entrega cada uma para
 * `casar_catalogo_erp`, que é onde a regra mora. A divisão é de propósito — a
 * regra dá para provar contra o banco, a chamada HTTP não.
 *
 * Sem isto, `skus.erp_ref` fica vazio e TODA baixa de estoque falha dizendo
 * "SKU sem referência no Bling". É o pré-requisito da baixa, não um extra.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const BLING = "https://api.bling.com.br/Api/v3";

/** O Bling pagina em 100. Teto de páginas para uma falha não virar laço infinito. */
const POR_PAGINA = 100;
const MAX_PAGINAS = 200;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return responder(405, { ok: false, motivo: "metodo_nao_suportado" });
  }

  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) {
    return responder(401, { ok: false, motivo: "sem_sessao" });
  }

  const url = Deno.env.get("SUPABASE_URL")!;

  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorizacao } },
  });

  const {
    data: { user },
  } = await comoUsuario.auth.getUser();

  if (!user) return responder(401, { ok: false, motivo: "sem_sessao" });

  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: perfil } = await servico
    .from("perfis")
    .select("ativo, papel")
    .eq("id", user.id)
    .maybeSingle();

  // Sincronizar catálogo reescreve a referência de todo SKU. Não é operação
  // de bancada.
  if (!perfil?.ativo || !["lider", "admin"].includes(String(perfil.papel))) {
    return responder(403, { ok: false, motivo: "sem_permissao" });
  }

  const { data: credencial } = await servico
    .schema("privado")
    .from("credenciais_erp")
    .select("access_token, expira_em")
    .maybeSingle();

  if (!credencial?.access_token) {
    return responder(400, { ok: false, motivo: "sem_credencial" });
  }

  if (credencial.expira_em && new Date(credencial.expira_em) <= new Date()) {
    return responder(400, { ok: false, motivo: "credencial_expirada" });
  }

  const total = {
    paginas: 0,
    produtos: 0,
    casados: 0,
    ja_estavam: 0,
    mudaram: 0,
    sem_codigo: 0,
    fotos: 0,
    repetidos: [] as string[],
  };

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    let resposta: Response;

    try {
      resposta = await fetch(
        `${BLING}/produtos?pagina=${pagina}&limite=${POR_PAGINA}`,
        {
          headers: {
            Authorization: `Bearer ${credencial.access_token}`,
            Accept: "application/json",
          },
        },
      );
    } catch (erro) {
      return responder(502, {
        ok: false,
        motivo: "bling_indisponivel",
        detalhe: erro instanceof Error ? erro.message : String(erro),
        parcial: total,
      });
    }

    if (!resposta.ok) {
      // Para onde parou: o que já casou está gravado, e o resto se resolve
      // rodando de novo. A função é reentrante de propósito.
      return responder(400, {
        ok: false,
        motivo: resposta.status === 401 ? "credencial_recusada" : `bling_${resposta.status}`,
        parcial: total,
      });
    }

    const json = (await resposta.json().catch(() => null)) as {
      data?: { id?: unknown; codigo?: unknown; imagemURL?: unknown }[];
    } | null;

    const produtos = Array.isArray(json?.data) ? json.data : [];
    if (produtos.length === 0) break;

    const { data: casamento, error } = await servico.rpc("casar_catalogo_erp", {
      p_produtos: produtos.map((p) => ({
        id: String(p?.id ?? ""),
        codigo: String(p?.codigo ?? ""),
        // Opcional: se a listagem do Bling não trouxer imagem, o campo some e
        // nada quebra — a foto só entra onde não há nenhuma.
        foto: typeof p?.imagemURL === "string" ? p.imagemURL : "",
      })),
    });

    if (error) {
      return responder(500, { ok: false, motivo: "erro_ao_casar", parcial: total });
    }

    const c = (Array.isArray(casamento) ? casamento[0] : casamento) as {
      casados: number;
      ja_estavam: number;
      mudaram: number;
      codigos_repetidos: string[] | null;
      sem_codigo: number;
      fotos: number;
    };

    total.paginas += 1;
    total.produtos += produtos.length;
    total.casados += c?.casados ?? 0;
    total.ja_estavam += c?.ja_estavam ?? 0;
    total.mudaram += c?.mudaram ?? 0;
    total.sem_codigo += c?.sem_codigo ?? 0;
    total.fotos += c?.fotos ?? 0;
    for (const r of c?.codigos_repetidos ?? []) {
      if (!total.repetidos.includes(r)) total.repetidos.push(r);
    }

    if (produtos.length < POR_PAGINA) break;
  }

  // Quantos SKUs ainda ficaram sem referência: é o número que importa, porque
  // cada um deles é uma baixa que vai falhar.
  const { count: semReferencia } = await servico
    .from("skus_sem_erp")
    .select("id", { count: "exact", head: true });

  return responder(200, {
    ok: true,
    motivo: "ok",
    ...total,
    sem_referencia: semReferencia ?? 0,
  });
});

function responder(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
