import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import {
  conectarBling,
  desconectarBling,
  salvarAplicacaoBling,
} from "./bling-acoes";

type Aplicacao = {
  configurada: boolean;
  client_id_final: string | null;
  atualizado_em: string | null;
};

type Saude = {
  conectada: boolean;
  expira_em: string | null;
  expirada: boolean;
  renovado_em: string | null;
  renovacoes: number;
  renovacao_erro: string | null;
};

/** O endereço que precisa estar cadastrado no aplicativo, lá no Bling. */
const RETORNO = "/integracao/bling/callback";

/**
 * A conexão com o Bling.
 *
 * São dois passos separados de propósito, porque acontecem em momentos
 * diferentes da vida: cadastrar o aplicativo é coisa de uma vez só; autorizar
 * é o que se refaz quando a conexão cai.
 */
export async function ConexaoBling({
  resultado,
  origem,
}: {
  /** O que voltou do Bling, vindo da rota de retorno. */
  resultado?: string;
  /** Origem pública do sistema, para montar o endereço de retorno. */
  origem: string;
}) {
  const supabase = await criarClienteServidor();

  const [{ data: app }, { data: saude }] = await Promise.all([
    supabase.rpc("erp_aplicacao_resumo"),
    supabase
      .from("saude_das_conexoes")
      .select("conectada, expira_em, expirada, renovado_em, renovacoes, renovacao_erro")
      .eq("alvo", "bling")
      .maybeSingle(),
  ]);

  const a = (Array.isArray(app) ? app[0] : app) as Aplicacao | null;
  const s = (saude ?? null) as Saude | null;

  const configurada = Boolean(a?.configurada);
  const conectada = Boolean(s?.conectada) && !s?.expirada;

  return (
    <section className="max-w-[760px] rounded-[9px] border border-linha">
      <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Conexão com o Bling
        </h3>
        {conectada ? (
          <span className="rounded-md border border-ok-linha bg-ok-bg px-[9px] py-[3px] text-[12px] font-semibold text-ok">
            Conectado
          </span>
        ) : s?.expirada ? (
          <span className="rounded-md border border-critico-linha bg-critico-bg px-[9px] py-[3px] text-[12px] font-semibold text-critico">
            Autorização expirada
          </span>
        ) : (
          <span className="rounded-md border border-linha bg-fundo px-[9px] py-[3px] text-[12px] font-semibold text-suave">
            Não conectado
          </span>
        )}
        <span className="flex-1" />
        {conectada && (
          <form action={desconectarBling}>
            <button
              type="submit"
              className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold"
            >
              Desconectar
            </button>
          </form>
        )}
      </header>

      {resultado && <Aviso resultado={resultado} />}

      {s?.renovacao_erro && !conectada && (
        <p className="m-0 border-b border-critico-linha bg-critico-bg px-4 py-3 font-mono text-[12px] leading-relaxed text-critico">
          {s.renovacao_erro}
        </p>
      )}

      {/* ---------------------------------------- passo 1: o aplicativo */}
      <div className="border-b border-linha px-4 py-4">
        <h4 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          1 · O aplicativo no Bling
        </h4>

        <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-suave">
          No painel de desenvolvedor do Bling, crie um aplicativo e cadastre
          este endereço como <b>link de redirecionamento</b>:
        </p>

        <code className="mt-2 block w-fit rounded-md border border-linha bg-fundo px-3 py-2 font-mono text-[13px] text-tinta">
          {origem}
          {RETORNO}
        </code>

        {configurada ? (
          <p className="mt-3 text-[13.5px]">
            Aplicativo cadastrado
            {a?.client_id_final && (
              <>
                {" "}
                — client_id terminado em{" "}
                <b className="font-mono font-semibold">{a.client_id_final}</b>
              </>
            )}
            .
          </p>
        ) : (
          <p className="mt-3 text-[13.5px] text-critico">
            Nenhum aplicativo cadastrado ainda.
          </p>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-semibold">
            {configurada ? "Trocar as credenciais" : "Cadastrar as credenciais"}
          </summary>

          <form action={salvarAplicacaoBling} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="bling-client-id"
                className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Client ID
              </label>
              <input
                id="bling-client-id"
                name="client_id"
                required
                autoComplete="off"
                className="w-[280px] rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[13px]"
              />
            </div>
            <div>
              <label
                htmlFor="bling-client-secret"
                className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Client Secret
              </label>
              <input
                id="bling-client-secret"
                name="client_secret"
                type="password"
                required
                autoComplete="off"
                className="w-[280px] rounded-lg border border-linha bg-superficie px-3 py-[9px] font-mono text-[13px]"
              />
            </div>
            <Botao
              trabalhando="Guardando…"
              className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
            >
              Guardar
            </Botao>
            <span className="max-w-[46ch] text-[12.5px] text-suave">
              O secret vai direto para o banco e não volta para nenhuma tela.
              Trocar o aplicativo apaga a autorização atual — token de um app
              não serve para outro.
            </span>
          </form>
        </details>
      </div>

      {/* ---------------------------------------- passo 2: a autorização */}
      <div className="px-4 py-4">
        <h4 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave">
          2 · A autorização
        </h4>

        {conectada ? (
          <p className="mt-2 text-[13.5px]">
            Autorizado
            {s?.renovado_em && (
              <> · renovado {quando(s.renovado_em)}</>
            )}
            {s?.expira_em && <> · vence {quando(s.expira_em)}</>}
            {typeof s?.renovacoes === "number" && s.renovacoes > 0 && (
              <>
                {" "}
                · {s.renovacoes}{" "}
                {s.renovacoes === 1
                  ? "renovação automática"
                  : "renovações automáticas"}
              </>
            )}
            .
          </p>
        ) : (
          <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-suave">
            Você vai para a tela do Bling, autoriza o aplicativo, e volta para
            cá. Feito uma vez, o sistema renova sozinho a cada dez minutos —
            uma hora antes de vencer, para ter tempo de tentar de novo se
            falhar.
          </p>
        )}

        <form action={conectarBling} className="mt-3">
          <Botao
            disabled={!configurada}
            trabalhando="Levando você ao Bling…"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {conectada ? "Autorizar de novo" : "Conectar o Bling"}
          </Botao>
        </form>

        {!configurada && (
          <p className="mt-2 text-[12.5px] text-suave">
            Cadastre o aplicativo acima primeiro.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * O que voltou do Bling, dito por inteiro.
 *
 * Cada recusa aponta para a coisa que resolve. "Não foi possível conectar"
 * manda a pessoa chutar.
 */
function Aviso({ resultado }: { resultado: string }) {
  if (resultado === "ok") {
    return (
      <p className="m-0 border-b border-ok-linha bg-ok-bg px-4 py-3 text-[13px] font-semibold text-ok">
        Bling conectado. A partir daqui a renovação é automática.
      </p>
    );
  }

  const texto: Record<string, string> = {
    recusado_no_bling:
      "A autorização foi cancelada na tela do Bling. Nada mudou aqui.",
    retorno_incompleto:
      "O Bling voltou sem o código de autorização. Comece de novo pelo botão Conectar.",
    estado_invalido:
      "Este retorno não corresponde a uma autorização iniciada agora — ou ele já foi usado uma vez. Por segurança nada foi enviado ao Bling: comece de novo pelo botão Conectar.",
    aplicacao_nao_configurada:
      "Cadastre o Client ID e o Client Secret antes de conectar.",
    sem_codigo: "O Bling voltou sem código. Comece de novo.",
    recusado:
      "O Bling recusou a troca. A resposta dele está logo abaixo — quase sempre é credencial trocada ou o link de redirecionamento diferente do cadastrado no aplicativo.",
    resposta_sem_token:
      "O Bling respondeu, mas sem token. A resposta dele está logo abaixo.",
    rede: "Não foi possível alcançar o Bling. A mensagem está logo abaixo.",
    so_admin: "Só um administrador conecta o Bling.",
  };

  return (
    <p className="m-0 border-b border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico">
      {texto[resultado] ?? "Não foi possível concluir a conexão."}
    </p>
  );
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
