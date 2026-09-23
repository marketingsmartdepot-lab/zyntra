/**
 * Pede a nota fiscal ao Faturador do Mercado Livre e aplica a resposta.
 *
 * Uma nota por PEDIDO. Pedido com vários produtos vira uma nota com vários
 * itens; pedidos diferentes viram notas diferentes, mesmo quando saem na
 * mesma caixa.
 *
 * Mesma razão da etiqueta para viver aqui: o token do ML não pode passar pelo
 * navegador nem pelo servidor do site. E aqui pesa mais, porque emitir nota é
 * IRREVERSÍVEL — o ML não tem endpoint de cancelamento, só o painel. Uma
 * emissão errada vira nota errada no SEFAZ, não um registro que se apaga.
 *
 * Por isso a ordem é sempre: o banco decide se pode emitir (conta ligada, não
 * pausada, chave de idempotência do pedido), e só depois esta função fala com o
 * ML. Nunca o contrário.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const ML = "https://api.mercadolibre.com";

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

  if (!perfil?.ativo) {
    return responder(403, { ok: false, motivo: "perfil_inativo" });
  }

  let corpo: { pedido_id?: string; manual?: boolean };
  try {
    corpo = await req.json();
  } catch {
    return responder(400, { ok: false, motivo: "corpo_invalido" });
  }

  if (!corpo.pedido_id) {
    return responder(400, { ok: false, motivo: "dados_incompletos" });
  }

  // Forçar a emissão por cima do desligado ou da pausa é decisão de quem
  // responde pela conta, não de qualquer operador.
  const manual = Boolean(corpo.manual);
  if (manual && !["lider", "admin"].includes(String(perfil.papel))) {
    return responder(403, { ok: false, motivo: "sem_permissao_para_forcar" });
  }

  // O banco decide primeiro. Se ele disser não, o ML nem é chamado.
  const { data: pedido, error: erroPedido } = await servico.rpc(
    "solicitar_nota",
    { p_pedido_id: corpo.pedido_id, p_manual: manual },
  );

  if (erroPedido) {
    return responder(500, { ok: false, motivo: "erro_ao_solicitar" });
  }

  const s = Array.isArray(pedido) ? pedido[0] : pedido;

  if (!s?.ok) {
    return responder(400, { ok: false, motivo: s?.motivo ?? "erro" });
  }

  // Já autorizada: não se pede de novo. Este é o caso que a chave de
  // idempotência existe para impedir.
  const { data: nota } = await servico
    .from("notas_fiscais")
    .select("id, situacao, pedidos_ref, conta_id, pedido_id")
    .eq("id", s.nota_id)
    .maybeSingle();

  if (nota?.situacao === "autorizada") {
    return responder(200, { ok: true, motivo: "ja_autorizada" });
  }

  const { data: conta } = await servico
    .from("contas")
    .select("ref_externa")
    .eq("id", nota?.conta_id)
    .maybeSingle();

  if (!conta?.ref_externa) {
    return responder(400, { ok: false, motivo: "conta_sem_id_do_canal" });
  }

  const { data: credencial } = await servico
    .schema("privado")
    .from("credenciais_conta")
    .select("access_token, expira_em")
    .eq("conta_id", nota?.conta_id)
    .maybeSingle();

  if (!credencial?.access_token) {
    return responder(400, { ok: false, motivo: "conta_sem_credencial" });
  }

  if (credencial.expira_em && new Date(credencial.expira_em) <= new Date()) {
    return responder(400, { ok: false, motivo: "credencial_expirada" });
  }

  let resposta: Response;
  let json: Record<string, unknown> = {};

  try {
    resposta = await fetch(
      `${ML}/users/${encodeURIComponent(conta.ref_externa)}/invoices/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credencial.access_token}`,
          "Content-Type": "application/json",
        },
        // UMA venda por chamada. A API aceita "uma ou mais", e a regra
        // fiscal aqui é uma nota por pedido: pedido com vários produtos vira
        // uma nota com vários itens, nunca duas notas.
        body: JSON.stringify({ orders: nota?.pedidos_ref ?? [] }),
      },
    );
    json = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (erro) {
    // Falha de rede: a nota fica `solicitada`. NÃO é registrada como
    // rejeitada — pode ter sido emitida do outro lado, e marcar rejeitada
    // levaria a pedir de novo e emitir duas.
    return responder(502, {
      ok: false,
      motivo: "ml_indisponivel",
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }

  if (resposta.ok) {
    await servico.rpc("registrar_resposta_nota", {
      p_nota_id: s.nota_id,
      p_autorizada: true,
      p_ref_externa: texto(json, ["id", "invoice_id"]),
      p_serie: texto(json, ["series", "serie"]),
      p_numero: numero(json, ["number", "numero"]),
      p_chave_acesso: texto(json, ["access_key", "key", "chave_acesso"]),
      p_xml_url: texto(json, ["xml_url", "xml"]),
      p_danfe_url: texto(json, ["pdf_url", "danfe_url"]),
    });

    return responder(200, { ok: true, motivo: "autorizada" });
  }

  // O ML nomeia o problema e diz qual campo consertar. É esse par que faz a
  // aba Aberto agrupar trinta pedidos numa causa só.
  const { data: aplicada } = await servico.rpc("registrar_resposta_nota", {
    p_nota_id: s.nota_id,
    p_autorizada: false,
    p_erro_codigo: texto(json, ["error_code", "error", "code"]) ?? `http_${resposta.status}`,
    p_erro_mensagem:
      texto(json, ["message", "error_message", "descricao"]) ??
      `O Mercado Livre recusou com ${resposta.status}`,
    p_campo_a_corrigir: campoACorrigir(json),
  });

  const a = Array.isArray(aplicada) ? aplicada[0] : aplicada;

  return responder(200, {
    ok: false,
    motivo: "rejeitada",
    disjuntor_acionado: Boolean(a?.disjuntor_acionado),
  });
});

/**
 * `front_properties.correctedBy` é onde o ML diz qual campo está errado.
 * O formato varia, então procuramos em vez de assumir.
 */
function campoACorrigir(json: Record<string, unknown>): string | null {
  const fp = json.front_properties;

  if (Array.isArray(fp)) {
    const achado = fp
      .map((p) => (p as Record<string, unknown>)?.correctedBy)
      .find(Boolean);
    return achado ? String(achado) : null;
  }

  if (fp && typeof fp === "object") {
    const c = (fp as Record<string, unknown>).correctedBy;
    if (c) return String(c);
  }

  return texto(json, ["corrected_by", "field"]);
}

function texto(json: Record<string, unknown>, chaves: string[]): string | null {
  for (const c of chaves) {
    const v = json[c];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function numero(json: Record<string, unknown>, chaves: string[]): number | null {
  for (const c of chaves) {
    const v = json[c];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

function responder(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
