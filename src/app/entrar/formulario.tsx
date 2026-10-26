"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { entrarPorPin } from "./pin-acoes";

type Aba = "equipe" | "estacao";

export function FormularioEntrada({
  destino,
  operadores,
  porta,
}: {
  destino: string;
  operadores: { id: string; nome: string }[];
  porta?: string;
}) {
  // Quem chega com um erro da porta cai direto na aba da porta: senão a
  // mensagem apareceria numa aba que a pessoa não está olhando.
  const [aba, setAba] = useState<Aba>(porta ? "estacao" : "equipe");

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

      {aba === "equipe" ? (
        <Equipe destino={destino} />
      ) : (
        <Estacao operadores={operadores} porta={porta} />
      )}
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

/**
 * Entrar por PIN: nome, quatro a oito dígitos, e cai na separação.
 *
 * Isto era uma casca: um teclado desenhado e desligado, que dizia "Nenhuma
 * estação cadastrada" para sempre porque nunca consultava nada. A Daniele
 * perdeu tempo nela tentando abrir a lista no celular.
 *
 * O que ela abre NÃO é a conta de ninguém — é a conta do aparelho, que só
 * enxerga a separação. O PIN, por cima, diz quem está com o celular na mão, e
 * é esse nome que assina o que for separado.
 *
 * Formulário de servidor, sem JavaScript de envio: a sessão é montada lá e
 * chega aqui como cookie. Token não passa pelo navegador.
 */
function Estacao({
  operadores,
  porta,
}: {
  operadores: { id: string; nome: string }[];
  porta?: string;
}) {
  const [quem, setQuem] = useState("");

  if (operadores.length === 0) {
    return (
      <div className="rounded-[10px] border border-grafite-linha bg-grafite-3 p-4">
        <p className="text-[14px] font-semibold text-offwhite">
          Ninguém tem PIN ainda
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-cinza-2">
          Cadastre as pessoas e defina o PIN de cada uma em{" "}
          <b className="font-semibold text-offwhite">Integração → Pessoas</b>.
          Até lá, entre pela aba Equipe.
        </p>
      </div>
    );
  }

  return (
    <form action={entrarPorPin}>
      {porta && <AvisoDaPorta motivo={porta} />}

      <span className="mb-[9px] block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2">
        Quem é você
      </span>

      <div className="mb-[18px] flex flex-col gap-2">
        {operadores.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-[14px] py-3 text-[14.5px] ${
              quem === o.id
                ? "border-champanhe bg-grafite-3 text-offwhite"
                : "border-grafite-linha bg-grafite-3 text-cinza-2"
            }`}
          >
            <input
              type="radio"
              name="operador"
              value={o.id}
              checked={quem === o.id}
              onChange={() => setQuem(o.id)}
              required
              className="h-[15px] w-[15px] accent-champanhe"
            />
            {o.nome}
          </label>
        ))}
      </div>

      <label
        htmlFor="pin-da-porta"
        className="mb-[9px] block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cinza-2"
      >
        PIN
      </label>
      <input
        id="pin-da-porta"
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        required
        minLength={4}
        maxLength={8}
        placeholder="••••"
        className={`${estiloCampo} mb-[18px] text-center font-mono text-[22px] tracking-[0.4em]`}
      />

      <button
        type="submit"
        disabled={!quem}
        className="w-full rounded-[10px] bg-champanhe py-[14px] text-[15px] font-bold text-grafite disabled:opacity-50"
      >
        Entrar na separação
      </button>

      <p className="mt-5 text-center text-[11.5px] leading-relaxed text-cinza-2">
        Quem entra por aqui só separa.
        <br />
        O aparelho fica seu por 12 horas — um turno.
      </p>
    </form>
  );
}

function AvisoDaPorta({ motivo }: { motivo: string }) {
  const texto: Record<string, string> = {
    pin_incorreto: "PIN errado. Restam tentativas antes de travar.",
    bloqueado:
      "Cinco erros seguidos: este nome está travado por dez minutos. Use a aba Equipe se for urgente.",
    sem_pin: "Esta pessoa ainda não tem PIN. Defina em Integração → Pessoas.",
    operador_invalido: "Esse nome não está mais ativo.",
    faltou: "Escolha o seu nome e digite o PIN.",
    servico_indisponivel: "O serviço não respondeu. Tente de novo.",
    nao_abriu_a_sessao: "O PIN está certo, mas a sessão não abriu. Me chame.",
  };

  return (
    <p
      role="alert"
      className="mb-4 rounded-lg border border-critico-linha/40 bg-critico/15 px-3 py-2 text-[12.5px] text-[#F0B8B0]"
    >
      {texto[motivo] ?? "Não foi possível entrar."}
    </p>
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
