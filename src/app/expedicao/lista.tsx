import Link from "next/link";
import type { Etapa, LinhaPacote } from "@/lib/supabase/tipos";
import { ondeEstaNoCanal, ABAS_EXPEDICAO } from "@/lib/supabase/tipos";
import {
  alterarEtapaDosMarcados,
  reprocessarMarcados,
} from "./etapa-acoes";
import { Botao } from "@/components/botao";
import { gerarLista } from "./listas/acoes";
import { tirarDoRetido } from "./retencao-acoes";
import { abrirEntregaDoca } from "../logistica/acoes";
import { FiltroColuna, type ValorDeFiltro } from "./filtro-coluna";
import { MarcarTodos } from "./marcar-todos";
import { ContagemSelecionada } from "./contagem-selecionada";

export function ListaPacotes({
  pacotes,
  etapa,
  vista,
  valores = [],
  filtros = {},
  permissoes = [],
  listas = {},
}: {
  pacotes: LinhaPacote[];
  etapa: Etapa;
  /** Qual aba está aberta: é ela que decide quais ações cabem. */
  vista: string;
  /** Os valores que existem em cada coluna desta etapa. */
  valores?: ValorDeFiltro[];
  /** Os filtros ativos, do endereço. */
  filtros?: Record<string, string | undefined>;
  /** O que esta pessoa pode fazer. Botão que ela não pode usar não aparece. */
  permissoes?: string[];
  /** De qual lista de separação é cada caixa, por id de pacote. */
  listas?: Record<string, { codigo: string; separador: string | null }>;
}) {
  const daColuna = (c: string) => valores.filter((v) => v.coluna === c);
  const marcados = (c: string) =>
    (filtros[c] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Conferir fica de fora de propósito: ali é uma caixa por vez na bancada, e
  // ação em massa desfaz justamente o que a conferência existe para garantir.
  // Duas condições diferentes de propósito: a ETAPA diz se a ação faz sentido
  // aqui, e a PERMISSÃO diz se esta pessoa a tem. Botão que aparece e volta
  // "sem permissão" ensina o time a desconfiar da tela.
  const liberado = (chave: string) => permissoes.includes(chave);
  const podeListar = vista === "separar" && liberado("gerar_lista");
  const podeDevolver = vista === "retido" && liberado("reter_pedido");
  const podeDoca = vista === "pronto";
  // A engrenagem aparece em toda aba: alterar etapa à mão serve justamente
  // quando a caixa está onde não devia, e isso acontece em qualquer uma.
  const podeAlterarEtapa = liberado("alterar_etapa");
  const podeReprocessar = liberado("reprocessar_pedido");
  // A engrenagem existe se houver pelo menos uma ação dentro dela. Menu vazio
  // é pior que menu ausente: a pessoa clica, não acha nada, e desconfia da
  // tela inteira.
  const temEngrenagem = podeAlterarEtapa || podeReprocessar;
  // A caixinha aparece em TODA aba, a pedido dela. Nas abas que ainda não têm
  // ação em massa ela não faz nada além de marcar — e é assim de propósito:
  // tirar a coluna de uma aba e pôr noutra faz o time procurar onde não tem.
  const selecionavel = true;
  const agora = Date.now();

  const tabela = (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {selecionavel && (
              <Cabecalho largura="42px">
                <MarcarTodos />
              </Cabecalho>
            )}
            <Cabecalho largura="56px">Canal</Cabecalho>
            <Cabecalho largura="176px">Código</Cabecalho>
            <Cabecalho largura="178px">Cliente</Cabecalho>
            <Cabecalho largura="158px">Conta</Cabecalho>
            <Cabecalho largura="150px">
              <FiltroColuna
                coluna="separacao"
                rotulo="Lista de separação"
                valores={daColuna("separacao")}
                selecionados={marcados("separacao")}
                outros={filtros}
              />
            </Cabecalho>
            <Cabecalho largura="112px">
              <FiltroColuna
                coluna="modalidade"
                rotulo="Modalidade"
                valores={daColuna("modalidade")}
                selecionados={marcados("modalidade")}
                outros={filtros}
              />
            </Cabecalho>
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
                  {listas[p.id] ? (
                    <>
                      <div className="font-mono text-[12.5px] font-semibold">
                        {listas[p.id].codigo}
                      </div>
                      <div className="mt-[2px] truncate text-[11.5px] text-suave">
                        {listas[p.id].separador ?? "sem separador"}
                      </div>
                    </>
                  ) : (
                    <span className="text-[12px] text-suave">—</span>
                  )}
                </Celula>

                <Celula>
                  <Selo tom="neutro">
                    {envio?.modalidades?.nome ?? "não classificada"}
                  </Selo>
                  {/*
                    Em Enviado e Entregue a modalidade sozinha não diz nada
                    útil: o que se quer saber é ONDE a caixa está. Nas abas de
                    trabalho não aparece, para não competir com o que o
                    operador precisa olhar.
                  */}
                  {(vista === "enviado" || vista === "entregue") &&
                    (() => {
                      const onde = ondeEstaNoCanal(
                        envio?.situacao_canal ?? null,
                        envio?.substatus_canal ?? null,
                      );
                      if (!onde) return null;

                      // Sem tradução vai em fonte de código: fica claro que é
                      // palavra de máquina e não frase que alguém escreveu, e
                      // quem vê sabe que tem um estado novo para nomear.
                      return (
                        <div
                          className={`mt-[2px] truncate text-[11.5px] text-suave ${
                            onde.traduzido ? "" : "font-mono text-[11px]"
                          }`}
                          title={
                            onde.traduzido
                              ? undefined
                              : "Estado novo do canal, ainda sem tradução"
                          }
                        >
                          {onde.texto}
                        </div>
                      );
                    })()}
                </Celula>

                <Celula>
                  <Prazo
                    limite={envio?.limite_envio_em ?? null}
                    agora={agora}
                    jaSaiu={vista === "enviado" || vista === "entregue"}
                  />
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
    <form className="flex flex-1 flex-col">
      <input type="hidden" name="vista" value={vista} />

      {/*
        A engrenagem fica DENTRO do formulário de propósito: fora dele ela não
        enxergaria quais caixas estão marcadas, e o botão mandaria uma lista
        vazia sem dizer por quê.
      */}
      {temEngrenagem && (
        <div className="flex items-center justify-end border-b border-linha bg-fundo px-5 py-[7px]">
          <details className="relative">
            <summary
              className="flex cursor-pointer list-none items-center gap-[6px] rounded-lg border border-linha bg-superficie px-[10px] py-[6px] text-[12.5px] font-semibold text-suave hover:text-tinta"
              aria-label="Ações em massa"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Ações
            </summary>

            <div className="absolute right-0 z-20 mt-2 w-[380px] rounded-[10px] border border-linha bg-superficie p-4 shadow-[0_10px_30px_rgba(17,25,28,.16)]">
              {podeReprocessar && (
                <div className={podeAlterarEtapa ? "mb-4 border-b border-linha pb-4" : ""}>
                  <h3 className="m-0 text-[13.5px] font-bold tracking-[-0.01em]">
                    Reprocessar pedido
                  </h3>
                  <p className="mb-3 mt-1 text-[12px] leading-relaxed text-suave">
                    Pergunta ao Mercado Livre de novo o estado das caixas
                    marcadas. Serve quando a etiqueta já está liberada lá e o
                    ZYNTRA ainda não enxergou — depois disso ela desce sozinha,
                    no próximo ciclo.
                  </p>

                  <Botao
                    formAction={reprocessarMarcados}
                    trabalhando="Perguntando ao ML…"
                    className="w-full rounded-lg border border-tinta px-4 py-[9px] text-[13px] font-semibold text-tinta"
                  >
                    Reprocessar os marcados
                  </Botao>
                </div>
              )}

              {podeAlterarEtapa && (
              <>
              <h3 className="m-0 text-[13.5px] font-bold tracking-[-0.01em]">
                Alterar status do pedido
              </h3>
              <p className="mb-3 mt-1 text-[12px] leading-relaxed text-suave">
                Move as caixas marcadas para a etapa escolhida, furando o
                caminho normal da esteira.
              </p>

              <label
                htmlFor="etapa-destino"
                className="mb-[5px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Para qual etapa
              </label>
              <select
                id="etapa-destino"
                name="etapa_destino"
                defaultValue=""
                className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[8px] text-[13px]"
              >
                <option value="" disabled>
                  — escolha —
                </option>
                {ABAS_EXPEDICAO.map((a) => (
                  <option key={a.etapa} value={a.etapa}>
                    {a.rotulo}
                  </option>
                ))}
                <option value="retido">Retidos</option>
              </select>

              <label
                htmlFor="etapa-motivo"
                className="mb-[5px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Motivo (obrigatório)
              </label>
              <input
                id="etapa-motivo"
                name="motivo_etapa"
                required
                minLength={5}
                placeholder="ex.: cliente retirou no balcão"
                className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[8px] text-[13px]"
              />

              <p className="mb-3 mt-0 rounded-lg border border-atencao-linha bg-atencao-bg px-3 py-2 text-[11.5px] leading-relaxed text-atencao">
                Isto muda só a etapa. Mover para <b>Enviado</b> por aqui{" "}
                <b>não cobra o custo de etiqueta</b> — ele só é contado no bipe
                da porta. E não grava saída, não fecha conferência e não
                imprime nada.
              </p>

              <Botao
                formAction={alterarEtapaDosMarcados}
                trabalhando="Alterando…"
                className="w-full rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
              >
                Alterar os marcados
              </Botao>
              </>
              )}
            </div>
          </details>
        </div>
      )}

      {tabela}

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-linha bg-fundo px-5 py-3">
        <ContagemSelecionada />

        {podeListar && (
          <span className="max-w-[60ch] text-[12.5px] text-suave">
            Marque os pedidos e gere a lista: os pedidos passam para{" "}
            <b>Conferir</b> no mesmo ato, e a folha abre para você escolher a
            impressora.
          </span>
        )}

        {podeDevolver && (
          <span className="max-w-[60ch] text-[12.5px] text-suave">
            Devolver manda cada pedido de volta para a etapa em que ele estava
            antes de ser retido — não para o começo. Nota, etiqueta e separação
            já feitas continuam valendo.
          </span>
        )}

        <span className="flex-1" />

        {podeDevolver && (
          <Botao
            formAction={tirarDoRetido}
            trabalhando="Devolvendo…"
            className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
          >
            Devolver para a esteira
          </Botao>
        )}

        {podeDoca && (
          <span className="flex items-center gap-2">
            <input
              id="doca-quem-pronto"
              name="entregue_por"
              aria-label="Quem está levando para a doca"
              placeholder="quem empurra o carrinho"
              className="w-[240px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13px]"
            />
            <Botao
              formAction={abrirEntregaDoca}
              trabalhando="Levando…"
              className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
            >
              Levar para a doca
            </Botao>
          </span>
        )}

        {/* Dois botões e não um seletor: o destino muda o que acontece com os
            pedidos AGORA — no papel eles já vão para Conferir, no coletor
            ficam esperando a separação fechar. Escolha dessas não deve ficar
            escondida num menu que se esquece de trocar. */}
        {podeListar && (
          <span className="flex flex-wrap items-center gap-2">
            <Botao
              formAction={gerarLista.bind(null, "papel")}
              trabalhando="Gerando…"
              className="rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
            >
              Gerar e imprimir
            </Botao>

            <Botao
              formAction={gerarLista.bind(null, "coletor")}
              trabalhando="Mandando…"
              className="rounded-lg border border-tinta px-4 py-[9px] text-[13px] font-semibold text-tinta"
            >
              Mandar pro coletor
            </Botao>
          </span>
        )}
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

/**
 * O prazo de despacho do canal.
 *
 * `jaSaiu` existe porque vermelho tem um trabalho: dizer "corre". Em Enviado e
 * Entregue não há o que correr — a caixa já foi — e pintar de vermelho as 142
 * caixas de setembro fazia o vermelho perder o sentido em TODAS as abas,
 * inclusive em Separar e Conferir, onde ele é o aviso que importa. O operador
 * aprende a ignorar o que grita sempre.
 *
 * A data continua aparecendo: ela dá o contexto de quando a caixa devia ter
 * saído. O que sai é o alarme, não a informação.
 */
function Prazo({
  limite,
  agora,
  jaSaiu,
}: {
  limite: string | null;
  agora: number;
  /** A caixa já saiu do galpão? Então o prazo é história, não cobrança. */
  jaSaiu?: boolean;
}) {
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
  const atrasado = !jaSaiu && faltam < 0;
  const urgente = !jaSaiu && faltam >= 0 && faltam <= 120;

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

  // "atrasado" e "em X min" são cobranças, e cobrança só cabe em quem ainda
  // está aqui. Para quem já saiu, a linha de baixo é só a data.
  const restante = jaSaiu
    ? dia
    : atrasado
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
      className="relative whitespace-nowrap border-b border-linha px-3 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
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
