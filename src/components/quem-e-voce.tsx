import { criarClienteServidor } from "@/lib/supabase/server";
import { identificarNoAparelho } from "@/app/identificar-acoes";

/**
 * A tela de "quem está com este aparelho".
 *
 * Serve ao coletor no corredor e ao computador da porta. Alvo grande porque
 * quem toca está de luva, com caixa na mão, e às vezes andando.
 */
export async function QuemEVoce({
  voltar,
  titulo,
  aviso,
}: {
  /** Para onde voltar depois de identificar. */
  voltar: string;
  titulo: string;
  /** O que houve na última tentativa. */
  aviso?: string;
}) {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("operadores_para_identificar")
    .select("id, nome, bloqueado")
    .order("nome");

  const gente = (data ?? []) as {
    id: string;
    nome: string;
    bloqueado: boolean;
  }[];

  const texto: Record<string, string> = {
    pin_incorreto: "PIN incorreto. Tente de novo.",
    bloqueado: "Cinco erros seguidos. Este nome fica travado por 10 minutos.",
    sem_pin: "Esta pessoa ainda não tem PIN. Peça para cadastrarem.",
    operador_invalido: "Esta pessoa não está mais ativa.",
    faltou: "Escolha o nome e digite o PIN.",
    erro: "Não foi possível conferir agora.",
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-6">
      <h1 className="m-0 mb-1 text-[20px] font-bold tracking-[-0.01em]">
        {titulo}
      </h1>
      <p className="m-0 mb-4 text-[14px] text-suave">Quem está com o aparelho?</p>

      {aviso && texto[aviso] && (
        <p className="m-0 mb-4 rounded-[12px] border border-critico-linha bg-critico-bg px-4 py-3 text-[14px] font-semibold text-critico">
          {texto[aviso]}
        </p>
      )}

      {gente.length === 0 ? (
        <p className="m-0 rounded-[12px] border border-linha px-4 py-8 text-center text-[14px] leading-snug text-suave">
          Ninguém com PIN cadastrado. Cadastre em Integração › Pessoas — quem só
          trabalha no galpão não precisa de e-mail, só de nome e PIN.
        </p>
      ) : (
        <form action={identificarNoAparelho} className="flex flex-col gap-3">
          <input type="hidden" name="voltar" value={voltar} />

          <div className="flex flex-col gap-2">
            {gente.map((p, i) => (
              <label
                key={p.id}
                className={`flex items-center gap-3 rounded-[12px] border px-4 py-4 ${
                  p.bloqueado
                    ? "border-linha opacity-50"
                    : "border-linha bg-superficie"
                }`}
              >
                <input
                  type="radio"
                  name="operador"
                  value={p.id}
                  defaultChecked={i === 0 && !p.bloqueado}
                  disabled={p.bloqueado}
                  className="h-[18px] w-[18px] accent-[var(--color-tinta)]"
                />
                <span className="text-[16px] font-semibold">{p.nome}</span>
                {p.bloqueado && (
                  <span className="ml-auto text-[12px] font-semibold text-critico">
                    travado
                  </span>
                )}
              </label>
            ))}
          </div>

          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            placeholder="PIN"
            aria-label="Seu PIN"
            className="rounded-[12px] border-2 border-tinta bg-superficie px-4 py-5 text-center font-mono text-[24px] tracking-[0.3em] outline-none"
          />

          <button
            type="submit"
            className="rounded-[12px] bg-tinta px-4 py-5 text-[17px] font-semibold text-white"
          >
            Entrar
          </button>
        </form>
      )}
    </main>
  );
}
