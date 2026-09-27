import { definirPermissoes } from "./equipe-acoes";

export type Permissao = {
  chave: string;
  grupo: string;
  rotulo: string;
  descricao: string;
};

/**
 * O que uma pessoa enxerga e faz.
 *
 * Administrador não aparece com caixinhas: ele pode tudo, e uma lista que
 * precisa estar completa para a dona funcionar é uma lista que um dia vai
 * travar a dona.
 *
 * As caixinhas ficam abertas num <details> porque a tela de equipe é lida
 * para conferir acesso, não para configurar — quem vai configurar abre.
 */
export function PermissoesDaPessoa({
  pessoa,
  papel,
  marcadas,
  possiveis,
}: {
  pessoa: string;
  papel: string;
  marcadas: string[];
  possiveis: Permissao[];
}) {
  if (papel === "admin") {
    return (
      <span className="text-[12px] text-suave">
        Administrador enxerga e faz tudo.
      </span>
    );
  }

  const grupos = [...new Set(possiveis.map((p) => p.grupo))];

  return (
    <details className="max-w-[420px]">
      <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-tinta">
        {marcadas.length === 0
          ? "Não enxerga nada ainda — escolher"
          : `${marcadas.length} ${marcadas.length === 1 ? "permissão" : "permissões"} — mudar`}
      </summary>

      <form action={definirPermissoes} className="mt-2 rounded-[9px] border border-linha p-3">
        <input type="hidden" name="pessoa" value={pessoa} />

        {grupos.map((g) => (
          <div key={g} className="mb-3 last:mb-0">
            <p className="m-0 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave">
              {g}
            </p>

            {possiveis
              .filter((p) => p.grupo === g)
              .map((p) => (
                <label
                  key={p.chave}
                  className="flex cursor-pointer gap-2 rounded-lg px-1 py-[5px] hover:bg-fundo"
                >
                  <input
                    type="checkbox"
                    name="permissao"
                    value={p.chave}
                    defaultChecked={marcadas.includes(p.chave)}
                    className="mt-[3px] h-[14px] w-[14px] shrink-0 accent-[var(--color-tinta)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">{p.rotulo}</span>
                    <span className="block text-[11.5px] leading-snug text-suave">
                      {p.descricao}
                    </span>
                  </span>
                </label>
              ))}
          </div>
        ))}

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
