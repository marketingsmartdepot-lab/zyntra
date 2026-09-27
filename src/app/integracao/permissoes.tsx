import { definirPermissoes } from "./equipe-acoes";

export type Permissao = {
  chave: string;
  grupo: string;
  rotulo: string;
  descricao: string;
  onde: string;
};

/**
 * O que uma pessoa enxerga e faz — tudo numa lista só.
 *
 * Inclusive a bipagem, que mora noutra tabela porque quem trabalha na bancada
 * entra por PIN e não tem login. Quem marca a caixinha não precisa saber
 * disso: a função do banco separa as chaves na hora de salvar.
 *
 * Administrador aparece com a lista inteira marcada e travada nos grupos do
 * sistema — ela pode tudo por ser dona, e uma lista que precisa estar completa
 * para a dona funcionar é uma lista que um dia vai travar a dona. Mas os
 * grupos da BANCADA continuam clicáveis: mandar no sistema não põe ninguém na
 * esteira, e reiniciar conferência é poder de bancada, não de dono.
 */
export function PermissoesDaPessoa({
  pessoa,
  papel,
  marcadas,
  possiveis,
  naBancada,
  temPin,
}: {
  pessoa: string;
  papel: string;
  marcadas: string[];
  possiveis: Permissao[];
  /** Esta pessoa já trabalha na bancada? */
  naBancada: boolean;
  /** Se está na bancada, já tem PIN para entrar? */
  temPin: boolean;
}) {
  const dona = papel === "admin";
  const grupos = [...new Set(possiveis.map((p) => p.grupo))];

  // Admin não guarda as chaves do sistema na lista dela (pode() devolve
  // verdadeiro para qualquer uma), mas a tela mostra tudo marcado: é o que
  // "posso ver tudo e mexer em tudo" significa, visto na tela.
  const marcada = (p: Permissao) =>
    (dona && p.onde === "perfil") || marcadas.includes(p.chave);

  const travada = (p: Permissao) => dona && p.onde === "perfil";

  const quantas = possiveis.filter(marcada).length;

  return (
    <details className="max-w-[440px]">
      <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-tinta">
        {dona
          ? `Pode tudo · ${quantas} de ${possiveis.length} — ver`
          : quantas === 0
            ? "Não pode nada ainda — escolher"
            : `${quantas} de ${possiveis.length} — mudar`}
      </summary>

      <form
        action={definirPermissoes}
        className="mt-2 rounded-[9px] border border-linha p-3"
      >
        <input type="hidden" name="pessoa" value={pessoa} />

        {/* Caixinha travada não é enviada pelo navegador. Sem isto, a dona
            salvar uma permissão de bancada apagaria a lista do sistema dela —
            inofensivo hoje, porque admin ignora a lista, e uma bomba no dia em
            que ela deixasse de ser admin. */}
        {dona &&
          marcadas
            .filter((c) => possiveis.some((p) => p.chave === c && p.onde === "perfil"))
            .map((c) => (
              <input key={c} type="hidden" name="permissao" value={c} />
            ))}

        {dona && (
          <p className="m-0 mb-3 rounded-lg bg-fundo px-3 py-2 text-[11.5px] leading-snug text-suave">
            Você é administradora: enxerga e faz tudo no sistema, sem depender
            destas caixinhas. As da <b className="font-semibold">bancada</b> são
            de verdade — lá quem manda é o PIN, não o login.
          </p>
        )}

        {grupos.map((g) => {
          const doGrupo = possiveis.filter((p) => p.grupo === g);
          const bancada = doGrupo[0]?.onde === "bancada";

          return (
            <div key={g} className="mb-3 last:mb-0">
              <p className="m-0 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave">
                {g}
              </p>

              {bancada && !naBancada && (
                <p className="m-0 mb-[6px] text-[11px] leading-snug text-suave">
                  Esta pessoa ainda não trabalha na bancada. Marcar uma destas
                  coloca ela lá — e aí falta só o PIN.
                </p>
              )}

              {bancada && naBancada && !temPin && (
                <p className="m-0 mb-[6px] text-[11px] leading-snug text-atencao">
                  Está na bancada mas ainda sem PIN: não consegue abrir turno.
                </p>
              )}

              {doGrupo.map((p) => (
                <label
                  key={p.chave}
                  className={`flex gap-2 rounded-lg px-1 py-[5px] ${
                    travada(p) ? "opacity-60" : "cursor-pointer hover:bg-fundo"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="permissao"
                    value={p.chave}
                    defaultChecked={marcada(p)}
                    disabled={travada(p)}
                    className="mt-[3px] h-[14px] w-[14px] shrink-0 accent-[var(--color-tinta)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">
                      {p.rotulo}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-suave">
                      {p.descricao}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          );
        })}

        <button
          type="submit"
          className="mt-1 rounded-lg bg-tinta px-3 py-[7px] text-[12.5px] font-semibold text-white"
        >
          Salvar o que esta pessoa pode
        </button>
      </form>
    </details>
  );
}
