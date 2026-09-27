import { criarClienteServidor } from "@/lib/supabase/server";

type Nota = {
  serie: string | null;
  numero: number | null;
  situacao: string;
  chave_acesso: string | null;
  xml_url: string | null;
  danfe_url: string | null;
  origem_emissao: string | null;
  emissor_nome: string | null;
  emissor_cnpj: string | null;
};

/**
 * Os documentos da caixa: a etiqueta e a nota.
 *
 * A etiqueta aparece como texto porque é texto — ZPL é o que a impressora
 * térmica entende, e é exatamente isto que o agente manda para ela. Mostrar o
 * conteúdo serve para quando a etiqueta sai errada e alguém precisa ver o que
 * foi enviado, em vez de adivinhar.
 */
export async function Anexos({ pacoteId }: { pacoteId: string }) {
  const supabase = await criarClienteServidor();

  const { data: pacote } = await supabase
    .from("pacotes")
    .select(
      `envio_id,
       envios ( ref_externa, etiqueta_conteudo, etiqueta_formato,
                etiqueta_obtida_em, etiqueta_erro, situacao_canal, substatus_canal,
                etiqueta_pdf )`,
    )
    .eq("id", pacoteId)
    .maybeSingle();

  const envio = (pacote as unknown as {
    envios: {
      ref_externa: string;
      etiqueta_conteudo: string | null;
      etiqueta_formato: string | null;
      etiqueta_obtida_em: string | null;
      etiqueta_erro: string | null;
      situacao_canal: string | null;
      substatus_canal: string | null;
      etiqueta_pdf: string | null;
    } | null;
  } | null)?.envios;

  const { data: notas } = await supabase
    .from("notas_fiscais")
    .select(
      `serie, numero, situacao, chave_acesso, xml_url, danfe_url,
       origem_emissao, emissor_nome, emissor_cnpj`,
    )
    .eq("pacote_id", pacoteId)
    .order("numero");

  const lista = (notas ?? []) as Nota[];

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* --------------------------------------------------- a etiqueta */}
      <section className="overflow-hidden rounded-[10px] border border-linha">
        <header className="flex flex-wrap items-center gap-3 border-b border-linha bg-fundo px-4 py-[10px]">
          <h3 className="m-0 text-[13.5px] font-bold tracking-[-0.01em]">
            Etiqueta do Mercado Livre
          </h3>
          {envio?.etiqueta_conteudo ? (
            <span className="rounded-full border border-[var(--color-ok)] bg-[var(--color-ok-bg)] px-[9px] py-[2px] text-[11px] font-semibold text-[var(--color-ok)]">
              guardada · {(envio.etiqueta_formato ?? "zpl").toUpperCase()}
            </span>
          ) : (
            <span className="rounded-full border border-atencao-linha bg-atencao-bg px-[9px] py-[2px] text-[11px] font-semibold text-atencao">
              ainda não obtida
            </span>
          )}
          <span className="flex-1" />
          {envio?.etiqueta_pdf && (
            <a
              href={`/expedicao/pacotes/${pacoteId}/etiqueta`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-linha bg-superficie px-3 py-[5px] text-[12px] font-semibold no-underline"
            >
              Ver etiqueta
            </a>
          )}
          {envio?.etiqueta_obtida_em && (
            <span className="text-[11.5px] text-suave">
              obtida{" "}
              {new Date(envio.etiqueta_obtida_em).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              })}
            </span>
          )}
        </header>

        <div className="px-4 py-3">
          {envio?.etiqueta_conteudo ? (
            <>
              <p className="m-0 mb-2 text-[12px] leading-relaxed text-suave">
                É este texto que vai para a Zebra na hora de imprimir. O agente
                da bancada recebe isto pronto — ele nunca fala com o Mercado
                Livre.
              </p>
              <pre className="m-0 max-h-[280px] overflow-auto rounded-lg border border-linha bg-fundo px-3 py-[10px] font-mono text-[11px] leading-[1.5] text-suave">
                {envio.etiqueta_conteudo}
              </pre>
              <p className="mb-0 mt-2 text-[11.5px] text-suave">
                {envio.etiqueta_conteudo.length.toLocaleString("pt-BR")}{" "}
                caracteres · envio {envio.ref_externa}
              </p>
            </>
          ) : envio?.etiqueta_erro ? (
            <p className="m-0 text-[13px] leading-relaxed text-critico">
              {envio.etiqueta_erro}
            </p>
          ) : (
            <p className="m-0 max-w-[80ch] text-[13px] leading-relaxed text-suave">
              O Mercado Livre só entrega a etiqueta quando o envio está pronto
              para imprimir. Este está como{" "}
              <b className="font-semibold">
                {envio?.situacao_canal ?? "—"}
                {envio?.substatus_canal && ` / ${envio.substatus_canal}`}
              </b>
              . Assim que liberar, ela entra aqui sozinha.
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- a nota */}
      <section className="overflow-hidden rounded-[10px] border border-linha">
        <header className="border-b border-linha bg-fundo px-4 py-[10px]">
          <h3 className="m-0 text-[13.5px] font-bold tracking-[-0.01em]">
            Nota fiscal
          </h3>
        </header>

        <div className="px-4 py-3">
          {lista.length === 0 ? (
            <p className="m-0 text-[13px] text-suave">
              Nenhuma nota ainda para esta caixa.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {lista.map((n, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <span className="text-[13.5px] font-semibold">
                    {n.serie && n.numero ? `Série ${n.serie} · nº ${n.numero}` : "Sem numeração"}
                    <span className="ml-2 font-normal text-suave">{n.situacao}</span>
                  </span>

                  {n.emissor_nome && (
                    <span className="text-[12px] text-suave">
                      emitida por {n.emissor_nome}
                      {n.emissor_cnpj && ` · ${cnpj(n.emissor_cnpj)}`}
                      {n.origem_emissao === "importada" && " · enviada ao ML por outro sistema"}
                      {n.origem_emissao === "meli" && " · pelo Faturador do Mercado Livre"}
                    </span>
                  )}

                  {n.chave_acesso && (
                    <code className="break-all font-mono text-[11px] text-suave">
                      {n.chave_acesso}
                    </code>
                  )}

                  <span className="mt-1 flex flex-wrap gap-2">
                    {n.xml_url && <Documento href={n.xml_url}>Abrir o XML</Documento>}
                    {n.danfe_url && <Documento href={n.danfe_url}>Abrir a DANFE</Documento>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Os endereços de XML e DANFE são da API do Mercado Livre e exigem o token da
 * conta — abrir direto no navegador devolve 401. Por isso o link diz o que é e
 * não promete o que não cumpre.
 */
function Documento({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Endereço na API do Mercado Livre — exige o token da conta"
      className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold no-underline"
    >
      {children}
    </a>
  );
}

function cnpj(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
