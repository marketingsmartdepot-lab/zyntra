"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";

/**
 * A porta de entrada, e só ela: e-mail e senha.
 *
 * Havia uma segunda aba, "Estação do galpão", com um teclado de PIN desenhado
 * e DESLIGADO. Ela não consultava nada: mostrava "Nenhuma estação cadastrada"
 * para sempre, mesmo com estações cadastradas, e prometia que o PIN
 * "começaria a valer" quando elas existissem.
 *
 * A promessa era falsa em dois níveis. A tela nunca olhava as estações — e,
 * mais fundo, o PIN nunca foi para entrar no sistema. O aparelho entra com uma
 * conta da equipe e fica logado; o PIN, em cima disso, diz QUEM está com ele
 * na mão agora — é o que faz a separação sair assinada e o bipe da porta ter
 * dono. São perguntas diferentes, e essa aba misturava as duas.
 *
 * A Daniele perdeu tempo nela tentando abrir a lista de separação no celular.
 * Tela que ensina coisa errada na porta de entrada custa mais que tela que
 * falta.
 */
export function FormularioEntrada({ destino }: { destino: string }) {
  return (
    <div className="w-[404px] rounded-2xl border border-grafite-linha bg-grafite-2 p-7">
      <Equipe destino={destino} />
    </div>
  );
}


function Equipe({ destino }: { destino: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error) {
      setErro(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message === "Email not confirmed"
            ? "Este e-mail ainda não foi confirmado. Procure a mensagem de confirmação na caixa de entrada."
            : `Não foi possível entrar: ${error.message}`,
      );
      setEnviando(false);
      return;
    }

    router.replace(destino);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} noValidate>
      <Campo id="email" rotulo="E-mail">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={estiloCampo}
        />
      </Campo>

      <Campo id="senha" rotulo="Senha">
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={estiloCampo}
        />
      </Campo>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-critico-linha/40 bg-critico/15 px-3 py-2 text-[12.5px] text-[#F0B8B0]"
        >
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-[10px] bg-champanhe py-[14px] text-[15px] font-bold text-grafite disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>

      <p className="mt-5 text-center text-[11.5px] leading-relaxed text-cinza-2">
        Cada pessoa tem a sua conta.
        <br />O que ela enxerga depende do papel: operador, líder, analista ou
        administrador.
      </p>
    </form>
  );
}


const estiloCampo =
  "w-full rounded-[10px] border border-grafite-linha bg-grafite-3 px-[14px] py-3 text-[14.5px] text-offwhite outline-none focus-visible:border-champanhe";

function Campo({
  id,
  rotulo,
  children,
}: {
  id: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-[15px]">
      <label
        htmlFor={id}
        className="mb-2 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2"
      >
        {rotulo}
      </label>
      {children}
    </div>
  );
}
