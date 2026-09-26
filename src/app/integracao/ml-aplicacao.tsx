import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import { salvarAplicacaoMl, conectarConta } from "./ml-acoes";

/**
 * O aplicativo do Mercado Livre e o botão de conectar contas.
 *
 * No Brasil o ML permite UM aplicativo por conta de desenvolvedor — então é um
 * só, e cada uma das lojas autoriza esse mesmo aplicativo. Por isso as
 * credenciais ficam aqui em cima, uma vez, e embaixo a conexão se repete por
 * conta.
 */
export async function AplicacaoMl({ origem }: { origem: string }) {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("aplicacao_ml");
  const app = (Array.isArray(data) ? data[0] : data) as
    | { configurada: boolean; client_id: string | null; redirect_uri: string | null; usa_pkce: boolean }
    | null;

  const retorno = `${origem}/integracao/ml/callback`;
  const configurada = app?.configurada === true;

  return (
    <section className="m-5 rounded-[9px] border border-linha">
      <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Aplicativo do Mercado Livre
        </h3>
        <span
          className={`rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold ${
            configurada
              ? "bg-[var(--color-ok-bg)] text-[var(--color-ok)]"
              : "bg-atencao-bg text-atencao"
          }`}
        >
          {configurada ? "configurado" : "falta configurar"}
        </span>
        <span className="flex-1" />
        {configurada && (
          <form action={conectarConta}>
            <Botao
              trabalhando="Abrindo o Mercado Livre…"
              className="rounded-lg border border-linha bg-superficie px-4 py-[9px] text-[13px] font-semibold"
            >
              Conectar uma conta
            </Botao>
          </form>
        )}
      </header>

      <div className="px-4 py-[14px]">
        <p className="m-0 max-w-[84ch] text-[12.5px] leading-relaxed text-suave">
          Crie o aplicativo em{" "}
          <a
            href="https://developers.mercadolivre.com.br/devcenter"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline"
          >
            developers.mercadolivre.com.br/devcenter
          </a>
          . No Brasil o Mercado Livre permite <b className="font-semibold">um
          aplicativo por conta</b> — este mesmo aplicativo serve para todas as
          lojas; cada uma autoriza depois, aqui embaixo.
        </p>

        <div className="mt-3 rounded-lg border border-linha bg-fundo px-3 py-[10px]">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-suave">
            URL de redirecionamento — cole exatamente isto no aplicativo
          </p>
          <code className="mt-1 block break-all font-mono text-[13px]">{retorno}</code>
          <p className="mb-0 mt-1 text-[12px] leading-relaxed text-suave">
            Tem de ser idêntica, inclusive a barra final. O Mercado Livre recusa
            qualquer diferença, e o erro que ele mostra não diz qual é.
          </p>
        </div>

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
              placeholder={configurada ? "•••••••• (mande de novo para trocar)" : ""}
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
              {configurada ? "Trocar credenciais" : "Salvar credenciais"}
            </Botao>
          </div>
        </form>
      </div>
    </section>
  );
}
