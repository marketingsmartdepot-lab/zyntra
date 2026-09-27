import { permissoesDeAgora } from "@/lib/permissoes";
import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import { salvarAplicacaoMl, conectarConta } from "./ml-acoes";

/**
 * O aplicativo do Mercado Livre e a conexão das contas.
 *
 * São dois passos e a ordem importa, então a tela numera os dois. No Brasil o
 * ML permite UM aplicativo por conta de desenvolvedor: cadastra-se uma vez, e
 * depois cada loja autoriza esse mesmo aplicativo. Enquanto o passo 1 não
 * estiver feito não há o que autorizar — e antes a tela simplesmente não
 * mostrava o botão, o que parecia defeito em vez de sequência.
 */
export async function AplicacaoMl({ origem }: { origem: string }) {
  const supabase = await criarClienteServidor();

  // Quem enxerga a Integração confere como está; quem pode mexer vê os
  // formulários. A trava de verdade está no banco — aqui é para a tela
  // não oferecer o que o banco vai recusar.
  const podeMexer = (await permissoesDeAgora()).has("mexer_integracao");
  const { data } = await supabase.rpc("aplicacao_ml");
  const app = (Array.isArray(data) ? data[0] : data) as
    | { configurada: boolean; client_id: string | null; redirect_uri: string | null; usa_pkce: boolean }
    | null;

  const retorno = `${origem}/integracao/ml/callback`;
  const pronto = app?.configurada === true;

  return (
    <div className="m-5 flex flex-col gap-4">
      {/* ------------------------------------------------ passo 1 */}
      <section className="rounded-[9px] border border-linha">
        <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3">
          <Numero feito={pronto}>1</Numero>
          <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
            O aplicativo do Mercado Livre
          </h3>
          <span className="text-[12.5px] text-suave">uma vez só, para todas as lojas</span>
          <span className="flex-1" />
          <span
            className={`rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold ${
              pronto
                ? "bg-[var(--color-ok-bg)] text-[var(--color-ok)]"
                : "bg-atencao-bg text-atencao"
            }`}
          >
            {pronto ? "cadastrado" : "falta cadastrar"}
          </span>
        </header>

        <div className="px-4 py-[14px]">
          <p className="m-0 max-w-[84ch] text-[12.5px] leading-relaxed text-suave">
            Crie em{" "}
            <a
              href="https://developers.mercadolivre.com.br/devcenter"
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              developers.mercadolivre.com.br/devcenter
            </a>
            . No Brasil o Mercado Livre permite{" "}
            <b className="font-semibold">um aplicativo por conta</b> — e é só um
            mesmo: as lojas não têm aplicativo cada uma, todas autorizam este.
          </p>

          <div className="mt-3 rounded-lg border border-linha bg-fundo px-3 py-[10px]">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-suave">
              URL de redirecionamento — cole exatamente isto no aplicativo
            </p>
            <code className="mt-1 block break-all font-mono text-[13px]">{retorno}</code>
            <p className="mb-0 mt-1 text-[12px] leading-relaxed text-suave">
              Tem de ser idêntica. O Mercado Livre recusa qualquer diferença, e o
              erro que ele mostra não diz qual é.
            </p>
          </div>

          {podeMexer && (
            <form action={salvarAplicacaoMl} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="redirect_uri" value={retorno} />
  
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-suave">
                  Client ID
                </span>
                <input
                  name="client_id"
                  required
                  defaultValue={app?.client_id ?? ""}
                  placeholder="1234567890123456"
                  className="w-[340px] max-w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[13.5px]"
                />
              </label>
  
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-suave">
                  Client Secret
                </span>
                <input
                  name="client_secret"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder={pronto ? "•••••••• (mande de novo para trocar)" : ""}
                  className="w-[340px] max-w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[13.5px]"
                />
                <span className="text-[12px] text-suave">
                  Fica guardada fora do alcance do navegador e não volta em leitura
                  nenhuma. Para trocar, mande a nova.
                </span>
              </label>
  
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="usa_pkce"
                  defaultChecked={app?.usa_pkce ?? false}
                  className="h-4 w-4"
                />
                Marquei &ldquo;Usar PKCE&rdquo; ao criar o aplicativo
              </label>
  
              <div>
                <Botao
                  trabalhando="Salvando…"
                  className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
                >
                  {pronto ? "Trocar credenciais" : "Salvar credenciais"}
                </Botao>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ passo 2 */}
      <section
        className={`rounded-[9px] border border-linha ${pronto ? "" : "opacity-60"}`}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3">
          <Numero feito={false}>2</Numero>
          <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
            Conectar as lojas
          </h3>
          <span className="text-[12.5px] text-suave">uma vez por loja</span>
        </header>

        <div className="px-4 py-[14px]">
          {pronto ? (
            <>
              <p className="m-0 mb-3 max-w-[84ch] text-[12.5px] leading-relaxed text-suave">
                Cada clique leva ao Mercado Livre para autorizar{" "}
                <b className="font-semibold">a loja em que você estiver logada lá</b>.
                Para conectar a próxima, saia daquela conta no Mercado Livre,
                entre na seguinte e clique de novo. A loja entra aqui com o
                apelido que tem no ML.
              </p>
              <form action={conectarConta}>
                <Botao
                  trabalhando="Abrindo o Mercado Livre…"
                  className="rounded-lg border border-linha bg-superficie px-4 py-[10px] text-[13.5px] font-semibold"
                >
                  Conectar uma conta
                </Botao>
              </form>
              <p className="mb-0 mt-2 text-[12px] leading-relaxed text-suave">
                Quem autoriza precisa entrar como <b className="font-semibold">
                administrador</b> daquela conta do ML. Colaborador não consegue —
                o Mercado Livre recusa.
              </p>
            </>
          ) : (
            <p className="m-0 max-w-[84ch] text-[13px] leading-relaxed text-suave">
              O botão de conectar aparece aqui assim que o passo 1 estiver
              salvo. Sem o Client ID e o Client Secret não há a quem o Mercado
              Livre entregue a autorização.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Numero({ children, feito }: { children: React.ReactNode; feito: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
        feito
          ? "bg-[var(--color-ok)] text-[var(--color-fundo)]"
          : "border border-linha text-suave"
      }`}
    >
      {feito ? "✓" : children}
    </span>
  );
}
