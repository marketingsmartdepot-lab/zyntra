import { criarClienteServidor } from "@/lib/supabase/server";
import { autorizarPessoa, definirPapel, revogarPessoa } from "./equipe-acoes";

type Pessoa = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  criado_em: string;
  autorizada: boolean;
};

type Convite = {
  email: string;
  papel: string;
  nome: string | null;
  criada_em: string;
  usada_em: string | null;
};

const PAPEL: Record<string, string> = {
  operador: "Operador",
  lider: "Líder",
  analista: "Analista",
  admin: "Administrador",
};

const PAPEIS = ["operador", "lider", "analista", "admin"] as const;

/**
 * Quem pode entrar no ZYNTRA.
 *
 * Diferente da aba Operadores: lá é quem trabalha na bancada e entra com PIN;
 * aqui é quem tem login de e-mail e senha no sistema. Uma pessoa pode estar
 * nas duas listas, ou só numa.
 *
 * A trava real não está nesta tela, está no banco: perfil que não foi
 * autorizado nasce inativo, e toda leitura do sistema exige perfil ativo.
 * Esta tela é o painel de quem tem a chave.
 */
export async function Equipe({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: pessoas }, { data: convites }] = await Promise.all([
    supabase.from("equipe_resumo").select("*").order("criado_em"),
    supabase.from("equipe_autorizada").select("*").order("criada_em"),
  ]);

  const lista = (pessoas ?? []) as Pessoa[];
  const pendentes = ((convites ?? []) as Convite[]).filter((c) => !c.usada_em);
  const semAutorizacao = lista.filter((p) => !p.ativo);

  return (
    <div className="flex flex-col gap-5 p-5">
      {falha && <Aviso motivo={falha} />}

      {semAutorizacao.length > 0 && (
        <p className="m-0 rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-3 text-[13.5px] text-atencao">
          <b className="font-semibold">
            {semAutorizacao.length}{" "}
            {semAutorizacao.length === 1
              ? "pessoa criou login"
              : "pessoas criaram login"}{" "}
            sem autorização.
          </b>{" "}
          Não enxergam nada do sistema — nem pedido, nem cliente, nem nota.
          Ficam listadas abaixo para você liberar ou ignorar.
        </p>
      )}

      {/* ------------------------------------------------ autorizar alguém */}
      <section className="rounded-[9px] border border-linha">
        <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          Autorizar uma pessoa
        </h3>
        <form
          action={autorizarPessoa}
          className="flex flex-wrap items-end gap-3 px-4 py-4"
        >
          <div>
            <label
              htmlFor="equipe-email"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              E-mail
            </label>
            <input
              id="equipe-email"
              name="email"
              type="email"
              required
              placeholder="pessoa@smartdepot.com.br"
              className="w-[280px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>
          <div>
            <label
              htmlFor="equipe-nome"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Nome
            </label>
            <input
              id="equipe-nome"
              name="nome"
              placeholder="opcional"
              className="w-[200px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            />
          </div>
          <div>
            <label
              htmlFor="equipe-papel"
              className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
            >
              Papel
            </label>
            <select
              id="equipe-papel"
              name="papel"
              defaultValue="operador"
              className="rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {PAPEL[p]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Autorizar
          </button>
          <span className="max-w-[44ch] text-[12.5px] text-suave">
            A pessoa cria a própria senha na tela de entrada. Autorizar antes é
            o que faz o login dela valer alguma coisa.
          </span>
        </form>
      </section>

      {/* ------------------------------------------------ quem tem login */}
      <section className="rounded-[9px] border border-linha">
        <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          Com login no sistema
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Pessoa", "Papel", "Situação", ""].map((c) => (
                  <th
                    key={c}
                    className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    <span className="block text-[13.5px] font-semibold">
                      {p.nome}
                    </span>
                    <span className="mt-[2px] block font-mono text-[11.5px] text-suave">
                      {p.email}
                    </span>
                  </td>
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    <form action={definirPapel} className="flex gap-2">
                      <input type="hidden" name="perfil" value={p.id} />
                      <select
                        name="papel"
                        defaultValue={p.papel}
                        aria-label={`Papel de ${p.nome}`}
                        className="rounded-lg border border-linha bg-superficie px-2 py-[6px] text-[13px]"
                      >
                        {PAPEIS.map((x) => (
                          <option key={x} value={x}>
                            {PAPEL[x]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold"
                      >
                        Salvar
                      </button>
                    </form>
                  </td>
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    {p.ativo ? (
                      <span className="rounded-md border border-ok-linha bg-ok-bg px-[9px] py-[3px] text-[12px] font-semibold text-ok">
                        Com acesso
                      </span>
                    ) : (
                      <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] text-[12px] font-semibold text-critico">
                        Sem acesso
                      </span>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-[10px] text-right">
                    {p.ativo ? (
                      <form action={revogarPessoa}>
                        <input type="hidden" name="email" value={p.email} />
                        <button
                          type="submit"
                          className="rounded-lg border border-critico-linha px-3 py-[6px] text-[12.5px] font-semibold text-critico"
                        >
                          Tirar o acesso
                        </button>
                      </form>
                    ) : (
                      <form action={autorizarPessoa}>
                        <input type="hidden" name="email" value={p.email} />
                        <input type="hidden" name="papel" value={p.papel} />
                        <button
                          type="submit"
                          className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold"
                        >
                          Liberar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* -------------------------------------- autorizados que não entraram */}
      {pendentes.length > 0 && (
        <section className="rounded-[9px] border border-linha">
          <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Autorizados que ainda não criaram o login
          </h3>
          <ul className="m-0 list-none p-0">
            {pendentes.map((c) => (
              <li
                key={c.email}
                className="flex flex-wrap items-center gap-3 border-b border-linha-suave px-4 py-[10px] last:border-b-0"
              >
                <span className="font-mono text-[13px] font-semibold">
                  {c.email}
                </span>
                <span className="text-[12.5px] text-suave">
                  {PAPEL[c.papel] ?? c.papel}
                  {c.nome && ` · ${c.nome}`}
                </span>
                <span className="flex-1" />
                <form action={revogarPessoa}>
                  <input type="hidden" name="email" value={c.email} />
                  <button
                    type="submit"
                    className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold"
                  >
                    Cancelar autorização
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="m-0 max-w-[80ch] text-[12.5px] text-suave">
        Tirar o acesso vale na hora e em tudo: a pessoa deixa de ler pedido,
        cliente, nota, custo e conta no mesmo instante, porque a regra está no
        banco e não na tela. O login continua existindo, só não enxerga nada —
        é o que permite religar depois sem refazer a senha.
      </p>
    </div>
  );
}

function Aviso({ motivo }: { motivo: string }) {
  const texto: Record<string, string> = {
    so_admin: "Só um administrador pode mexer em quem entra no sistema.",
    email_invalido: "Esse e-mail não parece um e-mail.",
    ultimo_admin:
      "Este é o último administrador com acesso. Tirar o dele deixaria o sistema sem ninguém capaz de liberar ninguém — promova outra pessoa a administrador antes.",
    perfil_nao_encontrado: "Essa pessoa não existe mais.",
  };

  return (
    <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13.5px] font-semibold text-critico">
      {texto[motivo] ?? "Não foi possível concluir."}
    </p>
  );
}
