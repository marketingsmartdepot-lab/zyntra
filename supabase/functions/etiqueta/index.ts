/**
 * Busca a etiqueta de envio no Mercado Livre e põe na fila da bancada.
 *
 * Roda aqui, e não no app, por um motivo só: o token do Mercado Livre não pode
 * passar pelo navegador nem pelo servidor do site. Esta função tem a chave de
 * serviço, lê a credencial da conta, fala com o ML e devolve apenas "deu certo"
 * ou "não deu, por isto". O ZPL vai direto para `impressoes.conteudo`, de onde
 * o agente da bancada retira.
 *
 * Ter a chave de serviço significa passar por cima de toda a RLS — por isso
 * esta função faz a própria autorização antes de qualquer coisa, usando o JWT
 * de quem chamou.
 *
 * E é por ter a chave de serviço que ela enfileira por
 * `solicitar_impressao_servico`, e não por `solicitar_impressao`: a segunda
 * exige `auth.uid()`, que aqui é NULO. Chamar a errada foi o que manteve a
 * impressão de etiqueta quebrada desde setembro — 500 em toda tentativa, e
 * nenhuma etiqueta jamais enfileirada. A porta de serviço cobra em troca o
 * `p_operador_id`, que é quem fica como dono da impressão.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ehZip, lerZip, zplDoZip } from "./zip.ts";

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

  // Cliente de quem chamou: serve só para provar quem é. Nada é lido com ele.
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorizacao } },
  });

  const {
    data: { user },
  } = await comoUsuario.auth.getUser();

  if (!user) return responder(401, { ok: false, motivo: "sem_sessao" });

  const servico = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Estar logado não basta: quem foi desativado não imprime.
  const { data: perfil } = await servico
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil?.ativo) {
    return responder(403, { ok: false, motivo: "perfil_inativo" });
  }

  let corpo: {
    pacote_id?: string;
    estacao_id?: string;
    operador_id?: string;
    motivo_reimpressao?: string;
  };

  try {
    corpo = await req.json();
  } catch {
    return responder(400, { ok: false, motivo: "corpo_invalido" });
  }

  const { pacote_id, estacao_id, operador_id, motivo_reimpressao } = corpo;

  if (!pacote_id || !estacao_id) {
    return responder(400, { ok: false, motivo: "dados_incompletos" });
  }

  // De qual envio é a etiqueta, e de qual conta é o token.
  const { data: pacote } = await servico
    .from("pacotes")
    .select(
      "conta_id, envios ( ref_externa, etiqueta_conteudo, modalidades ( gera_etiqueta ) )",
    )
    .eq("id", pacote_id)
    .maybeSingle();

  const envio = pacote?.envios as
    | {
        ref_externa: string;
        etiqueta_conteudo: string | null;
        modalidades: { gera_etiqueta: boolean } | null;
      }
    | null;

  if (!pacote || !envio?.ref_externa) {
    return responder(404, { ok: false, motivo: "pacote_sem_envio" });
  }

  if (envio.modalidades && !envio.modalidades.gera_etiqueta) {
    return responder(400, { ok: false, motivo: "modalidade_sem_etiqueta" });
  }

  // ------------------------------------------------- a etiqueta que ja temos
  //
  // A etiqueta JA ESTA AQUI quando a caixa chega na bancada: dois cron de
  // cinco em cinco minutos (`zyntra-etiquetas-pedir` e
  // `zyntra-etiquetas-coletar`) baixam o ZPL do ML e guardam em
  // `envios.etiqueta_conteudo` logo que o envio fica pronto para despacho.
  // Dos 10 pacotes na esteira hoje, 10 tinham o ZPL guardado.
  //
  // Esta funcao ignorava isso e pedia ao ML de novo, toda vez. Dava para
  // viver com isso enquanto a etiqueta saia de um clique numa tela; agora ela
  // sai no bipe que fecha a caixa, e nesse momento o galpao nao pode ficar
  // esperando a internet nem parar porque o ML esta fora. O papel que ele
  // precisa esta a um SELECT de distancia.
  //
  // O `^XA` e o que faz um texto ser ZPL: sem ele a Zebra cospe lixo, e e a
  // mesma checagem que vale para o que vem do ML mais abaixo.
  const guardada = (envio.etiqueta_conteudo ?? "").trim();

  if (guardada.includes("^XA")) {
    const { data, error } = await servico.rpc("solicitar_impressao_servico", {
      p_tipo: "etiqueta",
      p_conteudo: guardada,
      p_operador_id: operador_id ?? user.id,
      p_pacote_id: pacote_id,
      p_estacao_id: estacao_id,
      p_motivo_reimpressao: motivo_reimpressao ?? null,
    });

    if (error) {
      return responder(500, { ok: false, motivo: "erro_ao_enfileirar" });
    }

    const r = Array.isArray(data) ? data[0] : data;
    return responder(200, { ok: Boolean(r?.ok), motivo: r?.motivo ?? "erro" });
  }

  // ------------------------------- nao temos: buscar no ML na hora, como antes
  //
  // O schema `privado` e SELADO: nenhum papel tem grant nas tabelas dele, nem
  // a chave de servico. Ler privado.credenciais_conta pelo PostgREST daqui
  // nunca funcionou — este caminho vinha devolvendo `conta_sem_credencial`
  // sempre. Toda ponte para o `privado` e funcao `security definer`.
  //
  // De graca: token_do_canal RENOVA o token a cinco minutos do vencimento,
  // entao a checagem de validade que havia aqui deixou de ser necessaria.
  const { data: cred } = await servico.rpc("token_do_canal", {
    p_conta_id: pacote.conta_id,
  });

  const credencial = Array.isArray(cred) ? cred[0] : cred;

  if (!credencial?.token) {
    return responder(400, {
      ok: false,
      motivo: credencial?.motivo === "precisa_reconectar"
        ? "conta_precisa_reconectar"
        : "conta_sem_credencial",
    });
  }

  // O ML devolve ZIP quando há mais de uma etiqueta e texto cru quando há uma
  // só. Em vez de confiar no Content-Type, olhamos os bytes: a assinatura do
  // ZIP é inequívoca e não depende do servidor mandar o cabeçalho certo.
  let zpl: string;

  try {
    const resposta = await fetch(
      `${ML}/shipment_labels?shipment_ids=${encodeURIComponent(envio.ref_externa)}&response_type=zpl2`,
      { headers: { Authorization: `Bearer ${credencial.token}` } },
    );

    if (!resposta.ok) {
      return responder(400, {
        ok: false,
        motivo: await motivoDoMl(resposta),
      });
    }

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    zpl = ehZip(bytes)
      ? zplDoZip(await lerZip(bytes))
      : new TextDecoder().decode(bytes).trim();
  } catch (erro) {
    return responder(502, {
      ok: false,
      motivo: "ml_indisponivel",
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }

  if (!zpl.includes("^XA")) {
    // Veio algo que não é ZPL. Enfileirar isso faria a Zebra cuspir lixo.
    return responder(502, { ok: false, motivo: "resposta_nao_e_zpl" });
  }

  const { data, error } = await servico.rpc("solicitar_impressao_servico", {
    p_tipo: "etiqueta",
    p_conteudo: zpl,
    p_operador_id: operador_id ?? user.id,
    p_pacote_id: pacote_id,
    p_estacao_id: estacao_id,
    p_motivo_reimpressao: motivo_reimpressao ?? null,
  });

  if (error) {
    return responder(500, { ok: false, motivo: "erro_ao_enfileirar" });
  }

  const r = Array.isArray(data) ? data[0] : data;
  return responder(200, { ok: Boolean(r?.ok), motivo: r?.motivo ?? "erro" });
});

/**
 * O ML nomeia o problema no corpo. Repassar esse nome é o que permite a tela
 * dizer o que fazer em vez de "não foi possível".
 */
async function motivoDoMl(resposta: Response): Promise<string> {
  let erro = "";
  try {
    const json = await resposta.json();
    erro = String(json?.error ?? json?.message ?? "");
  } catch {
    // Corpo não-JSON: sobra o código HTTP.
  }

  if (erro.includes("not_printable_status")) return "envio_nao_liberado";
  if (erro.includes("invalid_shipment_ff_public")) return "envio_fulfillment";
  if (erro.includes("invalid_shipment_mode")) return "envio_fora_do_me2";
  if (erro.includes("invalid_shipment_caller")) return "credencial_de_outra_conta";
  if (resposta.status === 401 || resposta.status === 403) return "credencial_recusada";
  if (resposta.status === 404) return "envio_nao_encontrado";

  return `ml_${resposta.status}${erro ? `:${erro}` : ""}`;
}

function responder(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
