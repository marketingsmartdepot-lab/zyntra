"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Aba = "equipe" | "estacao";

export function FormularioEntrada({ destino }: { destino: string }) {
  const [aba, setAba] = useState<Aba>("equipe");

  return (
    <div className="w-[404px] rounded-2xl border border-grafite-linha bg-grafite-2 p-7">
      <div
        role="tablist"
        aria-label="Forma de entrar"
        className="mb-[22px] flex gap-1 rounded-xl border border-grafite-linha bg-grafite-3 p-[3px]"
      >
        <BotaoAba ativa={aba === "equipe"} onClick={() => setAba("equipe")}>
          Equipe
        </BotaoAba>
        <BotaoAba ativa={aba === "estacao"} onClick={() => setAba("estacao")}>
          Estação do galpão
        </BotaoAba>
      </div>

      {aba === "equipe" ? <Equipe destino={destino} /> : <Estacao />}
    </div>
  );
}

function BotaoAba({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`flex-1 whitespace-nowrap rounded-lg px-2 py-[9px] text-[12.5px] font-semibold transition-colors ${
        ativa
          ? "bg-champanhe text-grafite"
          : "text-cinza-2 hover:text-offwhite"
      }`}
    >
      {children}
    </button>
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

function Estacao() {
  return (
    <div>
      <div className="mb-4 rounded-[10px] border border-grafite-linha bg-grafite-3 p-4">
        <p className="text-[14px] font-semibold text-offwhite">
          Nenhuma estação cadastrada
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-cinza-2">
          A entrada por PIN começa a valer quando as estações da bancada
          existirem no sistema. Até lá, use a conta da equipe.
        </p>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none select-none opacity-40"
      >
        <span className="mb-[9px] block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2">
          PIN
        </span>
        <div className="mb-[18px] flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="block h-[13px] w-[13px] rounded-full border-[1.5px] border-grafite-linha-2"
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Limpar", "0", "Entrar"].map(
            (t) => (
              <span
                key={t}
                className={`rounded-[10px] border border-grafite-linha bg-grafite-3 py-[13px] text-center ${
                  t.length > 1
                    ? "text-[12.5px] font-semibold text-cinza-2"
                    : "font-mono text-[19px] font-semibold text-offwhite"
                }`}
              >
                {t}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
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
