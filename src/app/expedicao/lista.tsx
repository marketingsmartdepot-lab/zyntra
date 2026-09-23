import type { BloqueioTipo, Etapa, LinhaPacote } from "@/lib/supabase/tipos";
import { gerarLista } from "./listas/acoes";

const ROTULO_BLOQUEIO: Record<BloqueioTipo, string> = {
  sem_nota: "Sem nota",
  rejeicao_fiscal: "Rejeição fiscal",
  faturador_nao_configurado: "Faturador não configurado",
  sku_nao_mapeado: "SKU não mapeado",
  sem_etiqueta: "Sem etiqueta",
  sem_estoque: "Sem estoque",
  pedido_alterado: "Pedido alterado",
  impressao_fora_do_sistema: "Impressão fora do sistema",
};

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
            <Cabecalho largura="188px">Código</Cabecalho>
            <Cabecalho largura="196px">Conta / empresa</Cabecalho>
            <Cabecalho>Itens</Cabecalho>
            <Cabecalho largura="112px">Modalidade</Cabecalho>
            <Cabecalho largura="148px">Data limite</Cabecalho>
            <Cabecalho largura="132px">Etiqueta</Cabecalho>
            <Cabecalho largura="220px">Situação</Cabecalho>
          </tr>
        </thead>
        <tbody>
          {pacotes.map((p) => {
            const envio = p.envios;
            const pedidos = envio?.pedidos ?? [];
            const bloqueios = (p.bloqueios ?? []).filter(Boolean);
            const ehPack = pedidos.length > 1;

            return (
              <tr key={p.id}>
                {selecionavel && (
                  <Celula>
                    <input
                      type="checkbox"
                      name="pacote"
                      value={p.id}
                      aria-label={`Selecionar pacote ${pedidos[0]?.ref_externa ?? ""}`}
                      className="h-[15px] w-[15px] accent-[var(--color-tinta)]"
                    />
                  </Celula>
                )}
                <Celula>
                  <div className="font-mono text-[12.5px] font-medium tracking-[-0.02em]">
                    {pedidos[0]?.ref_externa ?? envio?.ref_externa ?? "—"}
                  </div>
                  <div className="mt-[2px] text-[11.5px] text-suave">
                    {ehPack
                      ? `pack · ${pedidos.length} pedidos · 1 etiqueta`
                      : "pedido único"}
                  </div>
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
                  <span className="text-[12.5px]">
                    {p.unidades_esperadas !== null
                      ? `${p.unidades_esperadas} ${p.unidades_esperadas === 1 ? "unidade" : "unidades"}`
                      : "—"}
                  </span>
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
                  {envio?.modalidades && !envio.modalidades.gera_etiqueta ? (
                    <Selo tom="neutro">Não gera</Selo>
                  ) : envio?.etiqueta_obtida_em ? (
                    <Selo tom="ok">Obtida</Selo>
                  ) : (
                    <Selo tom="atencao">Pendente</Selo>
                  )}
                </Celula>

                <Celula>
                  {bloqueios.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {bloqueios.slice(0, 2).map((b, i) => (
                        <span key={i}>
                          <Selo tom="critico">{ROTULO_BLOQUEIO[b.tipo]}</Selo>
                          {b.causa && (
                            <div className="mt-[2px] text-[11px] text-suave">
                              {b.causa}
                            </div>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11.5px] text-suave">
                      {situacaoDaEtapa(etapa, p.etapa_desde)}
                    </span>
                  )}
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
        <span className="text-[12.5px] text-suave">
          Marque os pacotes e gere a lista. Ela pode cruzar contas e empresas —
          quem anda pelo corredor não quer uma lista por CNPJ.
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

function situacaoDaEtapa(etapa: Etapa, desde: string) {
  const minutos = Math.max(
    0,
    Math.round((Date.now() - new Date(desde).getTime()) / 60000),
  );
  const tempo =
    minutos < 60
      ? `há ${minutos} min`
      : `há ${Math.floor(minutos / 60)}h ${minutos % 60}min`;

  if (etapa === "faturado") return `esperando etiqueta ${tempo}`;
  if (etapa === "separar") return `aguardando lista ${tempo}`;
  if (etapa === "conferir") return `na fila da bancada ${tempo}`;
  if (etapa === "pronto") return `lacrado ${tempo}`;
  return `nesta etapa ${tempo}`;
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
