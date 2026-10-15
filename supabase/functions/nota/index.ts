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

  const url = Deno.env.get("SUPABASE_URL")!;
  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Duas portas, porque há dois chamadores legítimos e nenhum pode virar o
  // outro.
  //
  // A TELA: um líder clicando "pedir a nota de novo", com sessão de usuário.
  // Só esta porta pode `manual: true` — forçar por cima do desligado e da
  // pausa é decisão de gente, com nome.
  //
  // O CRON: máquina falando com máquina, pelo segredo que já vive em
  // privado.config (o mesmo que a rota da etiqueta usa). Nunca manual.
  //
  // Esta função é publicada com verify_jwt DESLIGADO, porque o cron não tem
  // JWT de usuário. Então a autenticação é toda aqui: sem segredo válido e
  // sem sessão válida, nada passa.
  const segredoRecebido = req.headers.get("x-zyntra-segredo") ?? "";
  let pelaMaquina = false;

  if (segredoRecebido) {
    // O segredo é conferido DENTRO do banco e nunca sai de lá. O schema
    // `privado` é selado — nenhum papel tem grant nas tabelas dele, nem a
    // chave de serviço — então ler `privado.config` por aqui não funciona.
    // Toda ponte para o `privado` é função `security definer`.
    const { data: confere } = await servico.rpc("segredo_interno_confere", {
      p_segredo: segredoRecebido,
    });

    if (confere !== true) {
      return responder(401, { ok: false, motivo: "segredo_invalido" });
    }

    pelaMaquina = true;
  }

  let papel = "";

  if (!pelaMaquina) {
    const autorizacao = req.headers.get("Authorization") ?? "";
    if (!autorizacao.startsWith("Bearer ")) {
      return responder(401, { ok: false, motivo: "sem_sessao" });
    }

    const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: autorizacao } },
    });

    const {
      data: { user },
    } = await comoUsuario.auth.getUser();

    if (!user) return responder(401, { ok: false, motivo: "sem_sessao" });

    const { data: perfil } = await servico
      .from("perfis")
      .select("ativo, papel")
      .eq("id", user.id)
      .maybeSingle();

    if (!perfil?.ativo) {
      return responder(403, { ok: false, motivo: "perfil_inativo" });
    }

    papel = String(perfil.papel);
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
  // responde pela conta, não de qualquer operador — e nunca do cron.
  const manual = Boolean(corpo.manual);

  if (manual && pelaMaquina) {
    return responder(403, { ok: false, motivo: "maquina_nao_forca" });
  }

  if (manual && !["lider", "admin"].includes(papel)) {
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

  // Já `solicitada`: pedimos antes e não sabemos a resposta. O ML pode ter
  // emitido do outro lado — é o caso que o `catch` de rede abaixo cria de
  // propósito, deixando a nota em `solicitada` em vez de rejeitada.
  //
  // Mandar de novo aqui seria emitir a SEGUNDA nota do mesmo pedido, e o ML
  // não cancela por API, só pelo painel. Então não se manda: quem cura esta
  // linha é a varredura de notas, que atualiza a situação quando o ML
  // responde (a chave de idempotência das duas pontas casa para isso), ou uma
  // pessoa olhando o painel do ML. `marcar_notas_sem_resposta` dá rosto a
  // isto na aba Aberto quando demora demais.
  // O discriminador é o motivo que o banco devolveu, não a contagem de
  // tentativas:
  //   `ok`         -> a linha nasceu agora, ninguém falou com o ML ainda
  //   `reenviada`  -> estava `rejeitada`, o ML já respondeu "não" — pode ir
  //   `ja_existe`  -> já estava `solicitada`: é justamente o caso em que não
  //                   sabemos se o ML emitiu. Este não vai.
  if (nota?.situacao === "solicitada" && s.motivo === "ja_existe") {
    return responder(200, {
      ok: false,
      motivo: "ja_solicitada",
      detalhe:
        "A nota já foi pedida e a resposta não voltou. Confira no painel do " +
        "Mercado Livre antes de pedir de novo.",
    });
  }

  const { data: conta } = await servico
    .from("contas")
    .select("ref_externa")
    .eq("id", nota?.conta_id)
    .maybeSingle();

  if (!conta?.ref_externa) {
    return responder(400, { ok: false, motivo: "conta_sem_id_do_canal" });
  }

  // O token vem por função, pela mesma razão do segredo: `privado` é selado.
  // E `token_do_canal` já RENOVA o token a cinco minutos do vencimento, então
  // aqui não se checa validade — ou vem token bom, ou vem o motivo.
  const { data: cred } = await servico.rpc("token_do_canal", {
    p_conta_id: nota?.conta_id,
  });

  const c = Array.isArray(cred) ? cred[0] : cred;

  if (!c?.token) {
    return responder(400, {
      ok: false,
      motivo: c?.motivo === "precisa_reconectar"
        ? "conta_precisa_reconectar"
        : "conta_sem_credencial",
    });
  }

  let resposta: Response;
  let json: Record<string, unknown> = {};

  try {
    resposta = await fetch(
      `${ML}/users/${encodeURIComponent(conta.ref_externa)}/invoices/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.token}`,
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
