import { permissoesDeAgora } from "@/lib/permissoes";
import { criarClienteServidor } from "@/lib/supabase/server";
import {
  alternarOperador,
  alternarPermissao,
  criarOperador,
  definirPin,
  destravarOperador,
} from "./operadores-acoes";

type Operador = {
  id: string;
  nome: string;
  papel: string;
  ativo: boolean;
  tem_pin: boolean;
  tentativas_falhas: number;
  bloqueado: boolean;
  bloqueado_ate: string | null;
  em_turno_na_estacao: string | null;
  pode_reiniciar_conferencia: boolean;
  pode_bipar_por_sku: boolean;
};

const PAPEL: Record<string, string> = {
  operador: "Operador",
  lider: "Líder",
  analista: "Analista",
  admin: "Administrador",
};

export async function Operadores({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  // Quem enxerga a Integração confere como está; quem pode mexer vê os
  // formulários. A trava de verdade está no banco — aqui é para a tela
  // não oferecer o que o banco vai recusar.
  const podeMexer = (await permissoesDeAgora()).has("mexer_integracao");
  const { data } = await supabase
    .from("operadores_situacao")
    .select("*")
    .order("nome");

  const lista = (data ?? []) as Operador[];
  const semPin = lista.filter((o) => o.ativo && !o.tem_pin).length;
  const lideresComPin = lista.filter(
    (o) => o.ativo && o.papel === "lider" && o.tem_pin,
  ).length;

  return (
    <div className="flex flex-col gap-5 p-5">
      {falha && <Aviso resultado={falha} />}

      {lideresComPin === 0 && (
        <p className="m-0 rounded-lg border border-atencao-linha bg-atencao-bg px-4 py-3 text-[12.5px] font-semibold text-atencao">
          Nenhum líder ativo com PIN. Enquanto for assim, uma divergência
          registrada na bancada não tem quem libere — o pacote fica parado até
          um administrador destravar pelo sistema.
        </p>
      )}

      {lista.length === 0 ? (
        <p className="m-0 text-[13.5px] text-suave">
          Nenhum operador cadastrado. Quem trabalha na bancada não usa e-mail e
          senha: entra com nome e PIN.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[9px] border border-linha">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Nome", "Papel", "PIN", "Turno", "Pode", "Situação", ""].map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b border-linha px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className={o.ativo ? "" : "opacity-50"}>
                  <td className="border-b border-linha-suave px-4 py-3 text-[13.5px] font-semibold">
                    {o.nome}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 text-[12.5px]">
                    {PAPEL[o.papel] ?? o.papel}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3">
                    {o.tem_pin ? (
                      <Selo tom="ok">Definido</Selo>
                    ) : (
                      <Selo tom="atencao">Sem PIN</Selo>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 text-[12.5px]">
                    {o.em_turno_na_estacao ? (
                      <Selo tom="ok">Em turno</Selo>
                    ) : (
                      <span className="text-suave">—</span>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3">
                    <div className="flex flex-col gap-[5px]">
                      <Permissao
                        operador={o.id}
                        permissao="pode_reiniciar_conferencia"
                        podeMexer={podeMexer}
                        ligada={o.pode_reiniciar_conferencia}
                        rotulo="Reiniciar conferência"
                      />
                      <Permissao
                        operador={o.id}
                        permissao="pode_bipar_por_sku"
                        podeMexer={podeMexer}
                        ligada={o.pode_bipar_por_sku}
                        rotulo="Conferir digitando o SKU"
                      />
                    </div>
                  </td>

                  <td className="border-b border-linha-suave px-4 py-3">
                    {o.bloqueado ? (
                      <>
                        <Selo tom="critico">Bloqueado</Selo>
                        <span className="mt-[3px] block text-[11px] text-suave">
                          errou o PIN {o.tentativas_falhas}×
                        </span>
                      </>
                    ) : o.ativo ? (
                      <Selo tom="neutro">Ativo</Selo>
                    ) : (
                      <Selo tom="neutro">Desativado</Selo>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3">
                    <div className="flex flex-wrap items-end gap-2">
                      {podeMexer && (
                        <form
                          action={definirPin}
                          className="flex items-end gap-[6px]"
                        >
                          <input type="hidden" name="operador" value={o.id} />
                          <span>
                            <label
                              htmlFor={`pin-${o.id}`}
                              className="mb-[4px] block text-[9.5px] font-semibold uppercase tracking-[0.12em] text-suave"
                            >
                              {o.tem_pin ? "Trocar PIN" : "Definir PIN"}
                            </label>
                            <input
                              id={`pin-${o.id}`}
                              name="pin"
                              type="password"
                              inputMode="numeric"
                              autoComplete="new-password"
                              required
                              placeholder="4 a 8 dígitos"
                              className="w-[112px] rounded-lg border border-linha bg-superficie px-[9px] py-[6px] font-mono text-[12.5px]"
                            />
                          </span>
                          <button
                            type="submit"
                            className="rounded-lg border border-linha px-3 py-[6px] text-[12px] font-semibold"
                          >
                            Salvar
                          </button>
                        </form>
                      )}

                      {o.bloqueado && (
                        podeMexer && (
                          <form action={destravarOperador}>
                            <input type="hidden" name="operador" value={o.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-critico-linha px-3 py-[6px] text-[12px] font-semibold text-critico"
                            >
                              Destravar
                            </button>
                          </form>
                        )
                      )}

                      {podeMexer && (
                        <form action={alternarOperador}>
                          <input type="hidden" name="operador" value={o.id} />
                          <input
                            type="hidden"
                            name="ativo"
                            value={o.ativo ? "0" : "1"}
                          />
                          <button
                            type="submit"
                            className="rounded-lg border border-linha px-3 py-[6px] text-[12px] font-semibold text-suave"
                          >
                            {o.ativo ? "Desativar" : "Reativar"}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {semPin > 0 && (
        <p className="m-0 text-[12.5px] text-suave">
          {semPin} {semPin === 1 ? "operador ativo" : "operadores ativos"} sem
          PIN — {semPin === 1 ? "ele não consegue" : "eles não conseguem"} abrir
          turno.
        </p>
      )}

      {podeMexer && (
        <form
          action={criarOperador}
          className="max-w-[420px] rounded-[9px] border border-linha px-4 py-[14px]"
        >
          <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
            Cadastrar operador
          </h3>
          <p className="mb-3 mt-1 text-[12.5px] text-suave">
            Só líder ou administrador cadastra. O PIN é definido depois, na
            linha dele.
          </p>
  
          <label
            htmlFor="op-nome"
            className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
          >
            Nome
          </label>
          <input
            id="op-nome"
            name="nome"
            required
            className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
          />
  
          <label
            htmlFor="op-papel"
            className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
          >
            Papel
          </label>
          <select
            id="op-papel"
            name="papel"
            defaultValue="operador"
            className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
          >
            <option value="operador">Operador — bipa na bancada</option>
            <option value="lider">Líder — também libera divergência</option>
          </select>
  
          <button
            type="submit"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Cadastrar operador
          </button>
        </form>
      )}
    </div>
  );
}

function Aviso({ resultado }: { resultado: string }) {
  const ok = resultado === "pin_ok";
  const texto: Record<string, string> = {
    pin_ok: "PIN definido. Ele já pode abrir turno.",
    pin_formato: "O PIN precisa ter de 4 a 8 dígitos, só números.",
    sem_permissao:
      "Só líder ou administrador faz isso. Seu usuário não tem esse papel.",
    erro: "Não foi possível concluir.",
  };

  return (
    <p
      role="status"
      className={`m-0 rounded-lg border px-4 py-3 text-[12.5px] font-semibold ${
        ok
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[resultado] ?? texto.erro}
    </p>
  );
}

function Selo({
  tom,
  children,
}: {
  tom: "ok" | "atencao" | "critico" | "neutro";
  children: React.ReactNode;
}) {
  const estilo =
    tom === "ok"
      ? "bg-ok-bg text-ok border-ok-linha"
      : tom === "atencao"
        ? "bg-atencao-bg text-atencao border-atencao-linha"
        : tom === "critico"
          ? "bg-critico-bg text-critico border-critico-linha"
          : "border-linha text-suave";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold ${estilo}`}
    >
      {children}
    </span>
  );
}

/**
 * Uma permissão, ligada ou desligada num clique.
 *
 * O texto diz o que a pessoa passa a poder fazer, não o nome do campo: quem
 * cadastra operador não devia precisar traduzir "pode_bipar_por_sku".
 */
function Permissao({
  operador,
  permissao,
  ligada,
  rotulo,
  podeMexer,
}: {
  operador: string;
  permissao: string;
  ligada: boolean;
  rotulo: string;
  /** Sem isto a marcação aparece, mas não clica. */
  podeMexer: boolean;
}) {
  const conteudo = (
    <>
      <span
        aria-hidden
        className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border ${
          ligada ? "border-tinta bg-tinta text-white" : "border-linha"
        }`}
      >
        {ligada && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        )}
      </span>
      {rotulo}
    </>
  );

  const traco = `flex w-full items-center gap-[6px] rounded-md px-[6px] py-[3px] text-left text-[11.5px] ${
    ligada ? "font-semibold text-tinta" : "text-suave"
  }`;

  // Quem só enxerga a Integração lê o que cada operador da bancada pode; quem
  // pode mexer clica. A marcação é a mesma nos dois casos de propósito — ler
  // uma lista diferente da que o outro clica é como o time perde a confiança
  // na tela.
  if (!podeMexer) {
    return (
      <span className={traco} aria-disabled>
        {conteudo}
      </span>
    );
  }

  return (
    <form action={alternarPermissao}>
      <input type="hidden" name="operador" value={operador} />
      <input type="hidden" name="permissao" value={permissao} />
      <input type="hidden" name="ligar" value={ligada ? "0" : "1"} />
      <button type="submit" aria-pressed={ligada} className={traco}>
        {conteudo}
      </button>
    </form>
  );
}
