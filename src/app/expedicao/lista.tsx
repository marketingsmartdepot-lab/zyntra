import Link from "next/link";
import type { Etapa, LinhaPacote } from "@/lib/supabase/tipos";
import { gerarLista } from "./listas/acoes";

export function ListaPacotes({
  pacotes,
  etapa,
  selecionavel,
}: {
  pacotes: LinhaPacote[];
  etapa: Etapa;
  selecionavel?: boolean;
}) {
  const agora = Date.now();

  const tabela = (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {selecionavel && <Cabecalho largura="42px"> </Cabecalho>}
            <Cabecalho largura="56px">Canal</Cabecalho>
            <Cabecalho largura="176px">Código</Cabecalho>
            <Cabecalho largura="178px">Cliente</Cabecalho>
            <Cabecalho largura="158px">Conta</Cabecalho>
            <Cabecalho largura="112px">Modalidade</Cabecalho>
            <Cabecalho largura="142px">Data limite</Cabecalho>
            <Cabecalho largura="158px">NF-e</Cabecalho>
            <Cabecalho largura="150px">Etiqueta</Cabecalho>
            <Cabecalho largura="96px">Espera</Cabecalho>
          </tr>
        </thead>
        <tbody>
          {pacotes.map((p) => {
            const envio = p.envios;
            const pedidos = envio?.pedidos ?? [];
            const ehPack = pedidos.length > 1;
            const canal = p.contas?.canais ?? null;
            const nota = (p.notas_fiscais ?? [])[0] ?? null;

            return (
              <tr key={p.id} className="hover:bg-fundo">
                {selecionavel && (
                  <Celula>
                    <input
                      type="checkbox"
                      name="pacote"
                      value={p.id}
                      aria-label={`Selecionar ${pedidos[0]?.ref_externa ?? "pacote"}`}
                      className="h-[15px] w-[15px] accent-[var(--color-tinta)]"
                    />
                  </Celula>
                )}

                <Celula>
                  <Picto canal={canal} />
                </Celula>

                <Celula>
                  <Link
                    href={`/expedicao?etapa=${etapa}&pacote=${p.id}`}
                    className="block font-mono text-[12.5px] font-medium tracking-[-0.02em] text-tinta underline decoration-linha underline-offset-[3px] hover:decoration-tinta"
                  >
                    {pedidos[0]?.ref_externa ?? envio?.ref_externa ?? "—"}
                  </Link>
                  <div className="mt-[2px] text-[11.5px] text-suave">
                    {ehPack
                      ? `pack · ${pedidos.length} pedidos · 1 etiqueta`
                      : "pedido único"}
                  </div>
                </Celula>

                <Celula>
                  <span className="text-[12.5px]">
                    {pedidos[0]?.comprador ?? (
                      <span className="text-suave">—</span>
                    )}
                  </span>
                </Celula>

                <Celula>
                  <div className="text-[12.5px] font-semibold">
                    {p.contas?.apelido ?? "—"}
                  </div>
                  <div className="mt-[2px] text-[11.5px] text-suave">
                    {p.contas?.empresas?.nome_curto ?? "sem empresa emissora"}
                  </div>
                </Celula>

                <Celula>
                  <Selo tom="neutro">
                    {envio?.modalidades?.nome ?? "não classificada"}
                  </Selo>
                </Celula>

                <Celula>
                  <Prazo limite={envio?.limite_envio_em ?? null} agora={agora} />
                </Celula>

                <Celula>
                  {!nota ? (
                    <Selo tom="neutro">Sem nota</Selo>
                  ) : nota.situacao === "autorizada" ? (
                    <>
                      <Selo tom="ok">Autorizada</Selo>
                      <div className="mt-[2px] font-mono text-[11px] text-suave">
                        série {nota.serie ?? "—"} · nº {nota.numero ?? "—"}
                      </div>
                    </>
                  ) : nota.situacao === "rejeitada" ? (
                    <>
                      <Selo tom="critico">Rejeitada</Selo>
                      {nota.erro_mensagem && (
                        <div className="mt-[2px] text-[11px] text-suave">
                          {nota.erro_mensagem}
                        </div>
                      )}
                    </>
                  ) : nota.situacao === "cancelada" ? (
                    <Selo tom="critico">Cancelada</Selo>
                  ) : (
                    <Selo tom="atencao">Solicitada</Selo>
                  )}
                </Celula>

                <Celula>
                  {envio?.modalidades && !envio.modalidades.gera_etiqueta ? (
                    <>
                      <Selo tom="neutro">Não gera</Selo>
                      <div className="mt-[2px] text-[11px] text-suave">
                        envio combinado
                      </div>
                    </>
                  ) : envio?.etiqueta_obtida_em ? (
                    <Selo tom="ok">Obtida</Selo>
                  ) : (
                    <Selo tom="atencao">Pendente</Selo>
                  )}
                </Celula>

                <Celula>
                  <Espera desde={p.etapa_desde} />
                </Celula>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!selecionavel) return tabela;

  return (
    <form action={gerarLista} className="flex flex-1 flex-col">
      {tabela}
      <div className="mt-auto flex items-center gap-3 border-t border-linha bg-fundo px-5 py-3">
        <span className="max-w-[72ch] text-[12.5px] text-suave">
          Marque os pedidos e gere a lista: a folha sai na impressora desta
          bancada e os pedidos passam para <b>Conferir</b> no mesmo ato. A
          lista pode cruzar contas e empresas — quem anda pelo corredor não
          quer uma lista por CNPJ.
        </span>
        <span className="flex-1" />
        <button
          type="submit"
          className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
        >
          Gerar lista de separação
        </button>
      </div>
    </form>
  );
}

/**
 * O picto do marketplace. Imagem de verdade, vinda de `canais.icone_url`.
 * A sigla colorida só aparece quando o canal ainda não tem arquivo — é
 * reserva, não o desenho.
 */
function Picto({
  canal,
}: {
  canal: {
    nome: string;
    icone_url: string | null;
    sigla: string | null;
    cor: string | null;
    cor_texto: string | null;
  } | null;
}) {
  if (canal?.icone_url) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={canal.icone_url}
        alt={canal.nome}
        title={canal.nome}
        width={28}
        height={28}
        className="block h-7 w-7 rounded-[7px] object-contain"
      />
    );
  }

  return (
    <span
      title={canal?.nome ?? "canal não identificado"}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-[9.5px] font-bold"
      style={{
        background: canal?.cor ?? "var(--color-linha)",
        color: canal?.cor_texto ?? "var(--color-suave)",
      }}
    >
      {canal?.sigla ?? "?"}
    </span>
  );
}

function Espera({ desde }: { desde: string }) {
  const minutos = Math.max(
    0,
    Math.round((Date.now() - new Date(desde).getTime()) / 60000),
  );
  const longo = minutos >= 30;
  const texto =
    minutos < 60
      ? `${minutos} min`
      : minutos < 1440
        ? `${Math.floor(minutos / 60)}h ${minutos % 60}min`
        : `${Math.floor(minutos / 1440)} d`;

  return (
    <span
      className={`font-mono text-[14px] font-semibold tabular-nums ${longo ? "text-atencao" : ""}`}
    >
      {texto}
    </span>
  );
}

function Prazo({ limite, agora }: { limite: string | null; agora: number }) {
  if (!limite) {
    return (
      <span className="text-[13px] font-semibold text-suave">
        —
        <span className="block text-[11px] font-medium">sem prazo do canal</span>
      </span>
    );
  }

  const data = new Date(limite);
  const faltam = Math.round((data.getTime() - agora) / 60000);
  const atrasado = faltam < 0;
  const urgente = faltam >= 0 && faltam <= 120;

  const hora = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const dia = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const restante = atrasado
    ? `atrasado ${Math.abs(faltam)} min`
    : faltam < 60
      ? `em ${faltam} min`
      : dia;

  return (
    <span
      className={`text-[13px] font-semibold ${atrasado || urgente ? "text-critico" : ""}`}
    >
      {hora}
      <span
        className={`block text-[11px] font-medium ${atrasado || urgente ? "text-critico" : "text-suave"}`}
      >
        {restante}
      </span>
    </span>
  );
}

function Cabecalho({
  children,
  largura,
}: {
  children: React.ReactNode;
  largura?: string;
}) {
  return (
    <th
      style={largura ? { width: largura } : undefined}
      className="whitespace-nowrap border-b border-linha px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
    >
      {children}
    </th>
  );
}

function Celula({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-linha-suave px-3 py-[10px] align-middle">
      {children}
    </td>
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
