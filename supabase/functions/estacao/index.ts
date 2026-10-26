/**
 * Entrar por PIN, sem e-mail e sem senha.
 *
 * Quem separa no corredor pega o celular, escolhe o próprio nome, digita o
 * PIN e cai na lista. Nunca vê tela de login. Era o que a aba "Estação do
 * galpão" prometia desde sempre, e nunca fez — ela mostrava um teclado
 * desligado dizendo "Nenhuma estação cadastrada" para sempre.
 *
 * COMO A SESSÃO NASCE, que é a parte que precisa ser entendida antes de mexer:
 *
 * Um PIN não abre sessão sozinho — quem abre é uma conta. Então existe UMA
 * conta dedicada, a "conta do aparelho", com uma única permissão:
 * `separar_no_coletor`. Ela não é de ninguém. A pessoa é identificada por
 * cima, pelo PIN, e é o nome dela que assina a separação.
 *
 * A senha dessa conta é sorteada aqui na primeira vez e guardada em
 * `privado.config`, o schema selado. Ninguém a digita, a Daniele nunca a vê, e
 * ela não passa pelo navegador: o que volta para o celular é só a sessão já
 * pronta.
 *
 * Se um celular sumir, revoga-se essa conta e nenhuma PESSOA perde acesso.
 *
 * `verify_jwt: false` porque aqui ainda não existe JWT nenhum — é esta função
 * que cria o primeiro. A autorização dela é o próprio PIN, conferido no banco
 * com bcrypt e com a mesma trava de sempre: cinco erros, dez minutos parada.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const EMAIL_PADRAO = "coletor@aparelho.zyntra";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return responder(405, { ok: false, motivo: "metodo_nao_suportado" });
  }

  let corpo: { operador_id?: string; pin?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder(400, { ok: false, motivo: "corpo_invalido" });
  }

  const { operador_id, pin } = corpo;

  if (!operador_id || !pin) {
    return responder(400, { ok: false, motivo: "dados_incompletos" });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ------------------------------------------------------------- o PIN
  const { data: conferido, error: erroPin } = await servico.rpc(
    "conferir_pin_da_porta",
    { p_operador_id: operador_id, p_pin: pin },
  );

  if (erroPin) return responder(500, { ok: false, motivo: "erro_ao_conferir" });

  const c = Array.isArray(conferido) ? conferido[0] : conferido;

  if (!c?.ok) {
    // O motivo volta por extenso: "bloqueado" e "pin_incorreto" pedem coisas
    // diferentes de quem está na frente da tela. Um genérico faria a pessoa
    // tentar de novo e queimar as tentativas que restam.
    return responder(401, { ok: false, motivo: c?.motivo ?? "pin_incorreto" });
  }

  // --------------------------------------------- a conta do aparelho
  let credencial: { email: string; senha: string } | null = null;

  const { data: guardada } = await servico.rpc("conta_do_aparelho");
  const g = Array.isArray(guardada) ? guardada[0] : guardada;

  if (g?.email && g?.senha) {
    credencial = { email: g.email, senha: g.senha };
  } else {
    // Primeira vez: sorteia a senha e cria a conta. 32 bytes de aleatório do
    // sistema — ninguém escolhe, ninguém decora, ninguém digita.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const senha = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: criada, error: erroCriar } = await servico.auth.admin
      .createUser({
        email: EMAIL_PADRAO,
        password: senha,
        email_confirm: true,
      });

    if (erroCriar || !criada?.user) {
      return responder(500, { ok: false, motivo: "nao_criou_a_conta" });
    }

    await servico.rpc("gravar_conta_do_aparelho", {
      p_email: EMAIL_PADRAO,
      p_senha: senha,
    });

    await servico.rpc("garantir_perfil_do_aparelho", {
      p_id: criada.user.id,
      p_email: EMAIL_PADRAO,
    });

    credencial = { email: EMAIL_PADRAO, senha };
  }

  // --------------------------------------------------------- a sessão
  const { data: sessao, error: erroEntrar } = await servico.auth
    .signInWithPassword({
      email: credencial.email,
      password: credencial.senha,
    });

  if (erroEntrar || !sessao?.session) {
    return responder(500, { ok: false, motivo: "nao_abriu_a_sessao" });
  }

  // O perfil é reaplicado a cada entrada: se alguém acrescentar uma permissão
  // na mão nesta conta, ela não sobrevive à próxima vez que um PIN entrar.
  await servico.rpc("garantir_perfil_do_aparelho", {
    p_id: sessao.user.id,
    p_email: credencial.email,
  });

  return responder(200, {
    ok: true,
    operador: { id: operador_id, nome: c.nome },
    sessao: {
      access_token: sessao.session.access_token,
      refresh_token: sessao.session.refresh_token,
    },
  });
});

function responder(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
