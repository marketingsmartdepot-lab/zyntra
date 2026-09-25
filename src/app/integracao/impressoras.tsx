import { criarClienteServidor } from "@/lib/supabase/server";
import { Botao } from "@/components/botao";
import {
  ajustarImpressora,
  criarBancada,
  revogarMaquina,
} from "./impressoras-acoes";
import { AppDaBancada } from "./app-agente";

type Maquina = {
  id: string;
  nome_maquina: string;
  sistema: string | null;
  versao_agente: string | null;
  ultimo_contato_em: string | null;
  online: boolean;
  registrada_por: string | null;
  impressoras: number;
};

type Impressora = {
  id: string;
  dispositivo_id: string | null;
  nome_no_sistema: string | null;
  nome: string;
  linguagem: string;
  ativa: boolean;
  copias: number;
  estacao_id: string | null;
  vista_em: string | null;
};

type Bancada = { id: string; nome: string };

/**
 * As máquinas do galpão e as impressoras que elas têm.
 *
 * Nada aqui é digitado: o agente entra com o login da própria pessoa, registra
 * a máquina e manda a lista de impressoras que o sistema operacional enxerga.
 * O que se faz nesta tela é dizer o papel de cada uma — qual é a térmica, de
 * qual bancada, quantas cópias.
 *
 * Antes o admin digitava o nome da impressora à mão. Uma letra errada e a
 * bancada não imprimia, sem nenhuma mensagem dizendo por quê.
 */
export async function Impressoras({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: maq }, { data: imp }, { data: est }, { data: admin }, publicado] =
    await Promise.all([
      supabase.from("maquinas_do_agente").select("*").order("nome_maquina"),
      supabase
        .from("impressoras")
        .select("id, dispositivo_id, nome_no_sistema, nome, linguagem, ativa, copias, estacao_id, vista_em")
        .order("nome_no_sistema"),
      supabase.from("estacoes").select("id, nome").order("nome"),
      supabase.rpc("e_admin"),
      supabase.storage.from("app").list("", { limit: 100 }),
    ]);

  const maquinas = (maq ?? []) as Maquina[];
  const impressoras = (imp ?? []) as Impressora[];
  const bancadas = (est ?? []) as Bancada[];

  const instalador = (publicado.data ?? []).find((o) => o.name === "ZyntraAgente.exe");
  const tamanho = (instalador?.metadata as { size?: number } | null)?.size ?? null;
  // O endereço leva a data da publicação: sem isso a rede de distribuição
  // continuaria entregando a versão velha depois de publicar uma nova.
  const endereco = instalador
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/app/ZyntraAgente.exe` +
      `?v=${encodeURIComponent(instalador.updated_at ?? "")}`
    : null;

  return (
    <div className="flex flex-col gap-5 p-5">
      {falha && <Aviso resultado={falha} />}

      {maquinas.length === 0 ? (
        <ComoComecar />
      ) : (
        maquinas.map((m) => {
          const daMaquina = impressoras.filter((i) => i.dispositivo_id === m.id);

          return (
            <section key={m.id} className="rounded-[9px] border border-linha">
              <header className="flex flex-wrap items-center gap-3 border-b border-linha px-4 py-3">
                <span
                  aria-hidden
                  className={`h-[9px] w-[9px] rounded-full ${
                    m.online ? "bg-[var(--color-ok)]" : "bg-linha"
                  }`}
                />
                <h3 className="m-0 font-mono text-[14px] font-bold tracking-[-0.01em]">
                  {m.nome_maquina}
                </h3>
                <span className="text-[12.5px] text-suave">
                  {m.sistema ?? "sistema não informado"}
                  {m.versao_agente && ` · ${m.versao_agente}`}
                  {" · "}
                  {m.online
                    ? "online"
                    : m.ultimo_contato_em
                      ? `visto ${quando(m.ultimo_contato_em)}`
                      : "nunca se conectou"}
                </span>
                <span className="flex-1" />
                {m.registrada_por && (
                  <span className="text-[12px] text-suave">
                    instalada por {m.registrada_por}
                  </span>
                )}
                <form action={revogarMaquina}>
                  <input type="hidden" name="maquina" value={m.id} />
                  <Botao
                    trabalhando="Removendo…"
                    className="rounded-lg border border-critico-linha px-3 py-[6px] text-[12.5px] font-semibold text-critico"
                  >
                    Remover máquina
                  </Botao>
                </form>
              </header>

              {daMaquina.length === 0 ? (
                <p className="m-0 px-4 py-6 text-[13.5px] text-suave">
                  Esta máquina ainda não enviou nenhuma impressora. O agente
                  manda a lista ao iniciar — se a impressora foi instalada
                  depois, reinicie o agente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {["Impressora", "Imprime", "Bancada", "Cópias", ""].map(
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
                      {daMaquina.map((i) => (
                        <tr key={i.id}>
                          <td className="border-b border-linha-suave px-4 py-2 font-mono text-[13px]">
                            {i.nome_no_sistema ?? i.nome}
                          </td>
                          <td colSpan={4} className="border-b border-linha-suave px-4 py-2">
                            <form
                              action={ajustarImpressora}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input type="hidden" name="impressora" value={i.id} />

                              <select
                                name="linguagem"
                                defaultValue={i.linguagem}
                                aria-label="O que esta impressora imprime"
                                className="rounded-lg border border-linha bg-superficie px-2 py-[6px] text-[13px]"
                              >
                                <option value="zpl">Etiqueta térmica (ZPL)</option>
                                <option value="pdf">Papel comum (PDF)</option>
                              </select>

                              <select
                                name="ativa"
                                defaultValue={i.ativa ? "sim" : "nao"}
                                aria-label="Usar esta impressora"
                                className="rounded-lg border border-linha bg-superficie px-2 py-[6px] text-[13px]"
                              >
                                <option value="sim">Em uso</option>
                                <option value="nao">Não usar</option>
                              </select>

                              <select
                                name="estacao"
                                defaultValue={i.estacao_id ?? ""}
                                aria-label="Bancada"
                                className="rounded-lg border border-linha bg-superficie px-2 py-[6px] text-[13px]"
                              >
                                <option value="">— sem bancada —</option>
                                {bancadas.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.nome}
                                  </option>
                                ))}
                              </select>

                              <input
                                type="number"
                                name="copias"
                                min={1}
                                max={10}
                                defaultValue={i.copias}
                                aria-label="Número de cópias"
                                className="w-[70px] rounded-lg border border-linha bg-superficie px-2 py-[6px] text-[13px]"
                              />

                              <Botao
                                trabalhando="Salvando…"
                                className="rounded-lg border border-linha px-3 py-[6px] text-[12.5px] font-semibold"
                              >
                                Salvar
                              </Botao>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}

      {/* --------------------------------------------------- as bancadas */}
      <section className="max-w-[560px] rounded-[9px] border border-linha px-4 py-[14px]">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">Bancadas</h3>
        <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-suave">
          A bancada existe para a etiqueta sair do lado de quem bipou. Cada
          computador do galpão diz uma vez qual bancada ele é, em{" "}
          <b className="font-semibold">Qual bancada é esta</b>.
        </p>

        {bancadas.length > 0 && (
          <p className="mb-3 text-[13px]">
            {bancadas.map((b) => b.nome).join(" · ")}
          </p>
        )}

        <form action={criarBancada} className="flex flex-wrap items-end gap-2">
          <input
            name="nome"
            required
            placeholder="nome da bancada"
            aria-label="Nome da bancada"
            className="w-[240px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
          />
          <Botao
            trabalhando="Criando…"
            className="rounded-lg border border-linha px-4 py-[9px] text-[13px] font-semibold"
          >
            Criar bancada
          </Botao>
        </form>
      </section>

      <AppDaBancada
        endereco={endereco}
        publicadoEm={instalador?.updated_at ?? null}
        tamanhoMb={tamanho ? Math.round(tamanho / 1048576) : null}
        podePublicar={admin === true}
      />

      <ComoInstalar compacto={maquinas.length > 0} />
    </div>
  );
}

/** O que a tela mostra enquanto nenhuma máquina apareceu. */
function ComoComecar() {
  return (
    <section className="rounded-[9px] border border-atencao-linha bg-atencao-bg px-4 py-[14px]">
      <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em] text-atencao">
        Nenhuma máquina conectada
      </h3>
      <p className="mt-2 max-w-[80ch] text-[13.5px] leading-relaxed text-atencao">
        As impressoras aparecem aqui sozinhas assim que o agente rodar numa
        máquina do galpão. Ninguém cadastra impressora nesta tela — o agente
        manda a lista que o sistema operacional dele enxerga, e aqui você só
        diz qual delas é a térmica de cada bancada.
      </p>
    </section>
  );
}

function ComoInstalar({ compacto }: { compacto: boolean }) {
  return (
    <section className="rounded-[9px] border border-linha px-4 py-[14px]">
      <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
        Instalar numa máquina do galpão
      </h3>

      <ol className="m-0 mt-2 max-w-[84ch] list-decimal pl-5 text-[13px] leading-relaxed text-suave">
        <li className="mb-1">
          No computador da bancada, abra o ZYNTRA e clique em{" "}
          <b className="font-semibold">Baixar o app</b>, aqui em cima.
        </li>
        <li className="mb-1">
          Abra o arquivo baixado. Se o Windows avisar que não conhece o
          programa, clique em <b className="font-semibold">Mais informações</b>{" "}
          e depois em <b className="font-semibold">Executar assim mesmo</b> — é o
          aviso padrão para programa sem assinatura paga.
        </li>
        <li className="mb-1">
          Ele pede <b className="font-semibold">o e-mail e a senha do ZYNTRA</b>{" "}
          — os mesmos que a pessoa usa no sistema. A senha não fica guardada na
          máquina: vira uma credencial daquele computador, que você pode
          cancelar aqui a qualquer momento.
        </li>
        <li>
          Pronto. Ele se instala sozinho e passa a abrir junto com o Windows. A
          máquina e as impressoras dela aparecem nesta tela, e é aqui que você
          diz o que cada impressora imprime.
        </li>
      </ol>

      {!compacto && (
        <p className="mt-3 max-w-[84ch] text-[12.5px] leading-relaxed text-suave">
          O agente existe porque navegador não fala com impressora USB e a ZD220
          não tem rede — não há como imprimir a partir do servidor. Ele nunca
          fala com o Mercado Livre nem com o Bling: quem busca a etiqueta é o
          servidor, que tem as credenciais. O agente recebe o documento pronto e
          entrega à impressora.
        </p>
      )}
    </section>
  );
}

function Aviso({ resultado }: { resultado: string }) {
  const texto: Record<string, string> = {
    sem_permissao: "Só um administrador mexe em máquinas e impressoras.",
    sem_nome: "Dê um nome à bancada.",
    maquina_nao_encontrada: "Essa máquina já não existe mais.",
    linguagem_invalida: "Escolha ZPL ou PDF.",
    erro: "Não foi possível concluir.",
  };

  return (
    <p className="m-0 rounded-[9px] border border-critico-linha bg-critico-bg px-4 py-3 text-[13px] font-semibold text-critico">
      {texto[resultado] ?? "Não foi possível concluir."}
    </p>
  );
}

function quando(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
