import { criarClienteServidor } from "@/lib/supabase/server";
import { PermissoesDaPessoa, type Permissao } from "./permissoes";
import {
  autorizarPessoa,
  criarPessoaNaBancada,
  definirPapel,
  definirPin,
  destravarBancada,
  ligarBancada,
  revogarPessoa,
} from "./equipe-acoes";

type Pessoa = {
  pessoa_id: string;
  perfil_id: string | null;
  operador_id: string | null;
  nome: string;
  email: string | null;
  papel: string;
  ativo: boolean;
  criado_em: string;
  autorizada: boolean;
  na_bancada: boolean;
  tem_pin: boolean;
  bloqueado: boolean;
  tentativas_falhas: number;
  permissoes: string[] | null;
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
 * Toda pessoa do ZYNTRA, numa lista só.
 *
 * Antes eram duas telas: Equipe (quem tem login de e-mail e senha) e
 * Operadores (quem trabalha na bancada e entra por PIN). Duas listas de gente
 * obrigavam a dona a lembrar em qual delas cada permissão morava — e a
 * bipagem, que ela pediu junto com o resto, estava na outra.
 *
 * Agora entrar por e-mail, por PIN, ou pelos dois é um ATRIBUTO da pessoa. A
 * linha é a pessoa; como ela entra é uma coluna.
 *
 * A trava real não está aqui, está no banco: perfil não autorizado nasce
 * inativo, e cada ação confere a permissão antes de fazer.
 */
export async function Equipe({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: gente }, { data: convites }, { data: possiveis }] =
    await Promise.all([
      supabase.from("pessoas").select("*").order("nome"),
      supabase.from("equipe_autorizada").select("*").order("criada_em"),
      supabase.rpc("permissoes_possiveis"),
    ]);

  const lista = (gente ?? []) as Pessoa[];
  const permissoes = (possiveis ?? []) as Permissao[];
  const pendentes = ((convites ?? []) as Convite[]).filter((c) => !c.usada_em);
  const semAutorizacao = lista.filter((p) => p.perfil_id && !p.ativo);

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

      {/* ---------------------------------------------- cadastrar alguém */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[9px] border border-linha">
          <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Alguém que vai usar o sistema
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
                className="w-[250px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
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
                className="w-[160px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
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
              Ela cria a própria senha na tela de entrada. Autorizar antes é o
              que faz o login dela valer alguma coisa.
            </span>
          </form>
        </section>

        <section className="rounded-[9px] border border-linha">
          <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
            Alguém que só trabalha na bancada
          </h3>
          <form
            action={criarPessoaNaBancada}
            className="flex flex-wrap items-end gap-3 px-4 py-4"
          >
            <div>
              <label
                htmlFor="bancada-nome"
                className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Nome
              </label>
              <input
                id="bancada-nome"
                name="nome"
                required
                placeholder="como o time chama"
                className="w-[250px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
              />
            </div>
            <div>
              <label
                htmlFor="bancada-papel"
                className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Papel
              </label>
              <select
                id="bancada-papel"
                name="papel"
                defaultValue="operador"
                className="rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
              >
                <option value="operador">Operador</option>
                <option value="lider">Líder</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
            >
              Cadastrar
            </button>
            <span className="max-w-[44ch] text-[12.5px] text-suave">
              Sem e-mail e sem senha: a máquina da bancada fica logada o dia
              inteiro, e o PIN é o que diz quem está ali agora.
            </span>
          </form>
        </section>
      </div>

      {/* -------------------------------------------------- todo mundo */}
      <section className="rounded-[9px] border border-linha">
        <h3 className="m-0 border-b border-linha px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          Pessoas · {lista.length}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Pessoa", "Como entra", "O que pode", "Situação", ""].map(
                  (c, i) => (
                    <th
                      key={i}
                      className="border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-[13.5px] text-suave"
                  >
                    Ninguém cadastrado ainda.
                  </td>
                </tr>
              )}

              {lista.map((p) => (
                <tr key={p.pessoa_id} className="align-top">
                  {/* ------------------------------------------ quem é */}
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    <span className="block text-[13.5px] font-semibold">
                      {p.nome}
                    </span>
                    {p.email && (
                      <span className="mt-[2px] block font-mono text-[11.5px] text-suave">
                        {p.email}
                      </span>
                    )}
                    {p.perfil_id && (
                      <form action={definirPapel} className="mt-[6px] flex gap-2">
                        <input type="hidden" name="perfil" value={p.perfil_id} />
                        <select
                          name="papel"
                          defaultValue={p.papel}
                          aria-label={`Papel de ${p.nome}`}
                          className="rounded-lg border border-linha bg-superficie px-2 py-[5px] text-[12.5px]"
                        >
                          {PAPEIS.map((x) => (
                            <option key={x} value={x}>
                              {PAPEL[x]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg border border-linha px-[10px] py-[5px] text-[12px] font-semibold"
                        >
                          Salvar
                        </button>
                      </form>
                    )}
                  </td>

                  {/* ------------------------------------- como ela entra */}
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    <span className="flex flex-wrap gap-[5px]">
                      {p.perfil_id && (
                        <span className="rounded-md border border-linha px-[8px] py-[2px] text-[11.5px] font-semibold">
                          E-mail e senha
                        </span>
                      )}
                      {p.na_bancada && (
                        <span
                          className={`rounded-md border px-[8px] py-[2px] text-[11.5px] font-semibold ${
                            p.tem_pin
                              ? "border-linha"
                              : "border-atencao-linha text-atencao"
                          }`}
                        >
                          {p.tem_pin ? "PIN na bancada" : "Bancada sem PIN"}
                        </span>
                      )}
                      {!p.perfil_id && !p.na_bancada && (
                        <span className="text-[12px] text-suave">
                          não entra em lugar nenhum
                        </span>
                      )}
                    </span>

                    {p.na_bancada && p.operador_id && (
                      <form
                        action={definirPin}
                        className="mt-[6px] flex items-end gap-[6px]"
                      >
                        <input
                          type="hidden"
                          name="operador"
                          value={p.operador_id}
                        />
                        <input
                          id={`pin-${p.operador_id}`}
                          name="pin"
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          required
                          placeholder={p.tem_pin ? "trocar PIN" : "definir PIN"}
                          aria-label={`PIN de ${p.nome}`}
                          className="w-[120px] rounded-lg border border-linha bg-superficie px-2 py-[5px] text-[12.5px]"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-linha px-[10px] py-[5px] text-[12px] font-semibold"
                        >
                          OK
                        </button>
                      </form>
                    )}

                    {p.bloqueado && p.operador_id && (
                      <form action={destravarBancada} className="mt-[6px]">
                        <input
                          type="hidden"
                          name="operador"
                          value={p.operador_id}
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-critico-linha px-[10px] py-[5px] text-[12px] font-semibold text-critico"
                        >
                          Travada — destravar
                        </button>
                      </form>
                    )}
                  </td>

                  {/* --------------------------------------- o que pode */}
                  <td className="border-b border-linha-suave px-4 py-[10px]">
                    <PermissoesDaPessoa
                      pessoa={p.pessoa_id}
                      papel={p.papel}
                      marcadas={p.permissoes ?? []}
                      possiveis={permissoes}
                    />
                  </td>

                  {/* ----------------------------------------- situação */}
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

                  {/* ------------------------------------------- tirar */}
                  <td className="border-b border-linha-suave px-4 py-[10px] text-right">
                    {p.perfil_id && p.email ? (
                      p.ativo ? (
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
                      )
                    ) : (
                      <form action={ligarBancada}>
                        <input
                          type="hidden"
                          name="operador"
                          value={p.operador_id ?? ""}
                        />
                        <input
                          type="hidden"
                          name="ativo"
                          value={p.ativo ? "0" : "1"}
                        />
                        <button
                          type="submit"
                          className={`rounded-lg border px-3 py-[6px] text-[12.5px] font-semibold ${
                            p.ativo
                              ? "border-critico-linha text-critico"
                              : "border-linha"
                          }`}
                        >
                          {p.ativo ? "Desativar" : "Reativar"}
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
                <span className="font-mono text-[13px]">{c.email}</span>
                <span className="text-[12.5px] text-suave">
                  {PAPEL[c.papel] ?? c.papel}
                  {c.nome ? ` · ${c.nome}` : ""}
                </span>
                <span className="flex-1" />
                <form action={revogarPessoa}>
                  <input type="hidden" name="email" value={c.email} />
                  <button
                    type="submit"
                    className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold text-suave"
                  >
                    Cancelar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * O que a última ação fez. Cada recusa diz o motivo em português: "não foi
 * possível" faz a pessoa tentar de novo achando que foi engano.
 */
function Aviso({ motivo }: { motivo: string }) {
  const bons = ["permissoes_salvas", "pin_ok", "pessoa_criada"];

  const texto: Record<string, string> = {
    permissoes_salvas: "Salvo. O que esta pessoa pode mudou.",
    pin_ok: "PIN definido.",
    pessoa_criada: "Pessoa cadastrada na bancada. Falta o PIN.",
    pin_formato: "O PIN tem de ter de 4 a 8 números.",
    nome_vazio: "Falta o nome.",
    email_invalido: "E-mail inválido.",
    sem_permissao: "Você não tem permissão de mexer nas pessoas.",
    nao_tire_a_sua_propria:
      "Você não pode tirar a sua própria permissão de mexer nas pessoas — ficaria trancada do lado de fora.",
    pessoa_nao_encontrada: "Essa pessoa não existe mais.",
    erro: "Não foi possível concluir.",
  };

  const bom = bons.includes(motivo);

  return (
    <p
      className={`m-0 rounded-[9px] border px-4 py-3 text-[13.5px] ${
        bom
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[motivo] ?? "Não foi possível concluir."}
    </p>
  );
}
