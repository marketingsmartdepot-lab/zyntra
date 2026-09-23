import { criarClienteServidor } from "@/lib/supabase/server";
import { criarEstacao, criarImpressora } from "./acoes";
import { BotaoToken } from "./token";

type Impressora = {
  id: string;
  nome: string;
  modelo: string | null;
  conexao: string;
  linguagem: string;
  dpi: number | null;
  largura_mm: number | null;
  ativa: boolean;
  agente_versao: string | null;
  ultimo_contato_em: string | null;
  estacao: string | null;
  agente_online: boolean;
  token_gerado: boolean;
  na_fila: number;
  ultimo_trabalho_em: string | null;
};

type Estacao = { id: string; nome: string };

export async function Impressoras() {
  const supabase = await criarClienteServidor();

  const [{ data: impressoras }, { data: estacoes }] = await Promise.all([
    supabase.from("impressoras_situacao").select("*").order("nome"),
    supabase.from("estacoes").select("id, nome").order("nome"),
  ]);

  const lista = (impressoras ?? []) as Impressora[];
  const bancadas = (estacoes ?? []) as Estacao[];

  return (
    <div className="flex flex-col gap-5 p-5">
      <section className="rounded-[9px] border border-linha bg-fundo px-4 py-[14px]">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          Por que existe um agente
        </h3>
        <p className="mt-2 max-w-[86ch] text-[13px] leading-relaxed text-suave">
          Navegador não fala com impressora USB. A <b>Zebra ZD220</b> é o modelo
          de entrada e <b>só tem USB</b> — sem Ethernet, sem Wi-Fi. Isso quer
          dizer que não existe imprimir a partir do servidor: um agente precisa
          rodar na própria máquina onde a impressora está plugada.
        </p>
        <p className="mt-2 max-w-[86ch] text-[13px] leading-relaxed text-suave">
          O ZYNTRA enfileira o trabalho e mostra se aquele agente está vivo.{" "}
          <b>Sem batida recente, a tela recusa a impressão</b> em vez de fingir
          que mandou — comando enviado nunca foi prova de papel.
        </p>
      </section>

      {lista.length === 0 ? (
        <p className="rounded-[9px] border border-linha px-4 py-6 text-center text-[13.5px] text-suave">
          Nenhuma impressora cadastrada. Cadastre a estação primeiro e depois a
          impressora dela.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[9px] border border-linha">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "Impressora",
                  "Estação",
                  "Conexão",
                  "Agente",
                  "Fila",
                  "Token",
                ].map((c) => (
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
              {lista.map((i) => (
                <tr key={i.id}>
                  <td className="border-b border-linha-suave px-4 py-3 align-top">
                    <span className="text-[13px] font-semibold">{i.nome}</span>
                    <span className="mt-[2px] block text-[11.5px] text-suave">
                      {i.modelo ?? "modelo não informado"}
                      {i.dpi && ` · ${i.dpi} dpi`}
                      {i.largura_mm && ` · ${i.largura_mm} mm`}
                      {" · "}
                      {i.linguagem.toUpperCase()}
                    </span>
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 align-top text-[12.5px]">
                    {i.estacao ?? (
                      <span className="text-suave">sem estação</span>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 align-top">
                    <Selo tom={i.conexao === "usb" ? "neutro" : "ok"}>
                      {i.conexao === "usb" ? "USB" : "Rede"}
                    </Selo>
                    {i.conexao === "usb" && (
                      <span className="mt-[3px] block text-[11px] text-suave">
                        agente na máquina
                      </span>
                    )}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 align-top">
                    {i.agente_online ? (
                      <Selo tom="ok">Online</Selo>
                    ) : (
                      <Selo tom="critico">Offline</Selo>
                    )}
                    <span className="mt-[3px] block text-[11px] text-suave">
                      {i.ultimo_contato_em
                        ? `último contato ${quando(i.ultimo_contato_em)}`
                        : "nunca bateu ponto"}
                      {i.agente_versao && ` · ${i.agente_versao}`}
                    </span>
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 align-top font-mono text-[15px] font-semibold tabular-nums">
                    {i.na_fila}
                  </td>
                  <td className="border-b border-linha-suave px-4 py-3 align-top">
                    <BotaoToken impressoraId={i.id} jaTem={i.token_gerado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Formulario
          titulo="Cadastrar estação"
          descricao="A bancada física. Uma estação pode ter uma impressora."
          acao={criarEstacao}
          botao="Cadastrar estação"
        >
          <Campo id="est-nome" rotulo="Nome" nome="nome" obrigatorio />
          <Campo
            id="est-local"
            rotulo="Local"
            nome="local"
            dica="Ex.: bancada de conferência"
          />
        </Formulario>

        <Formulario
          titulo="Cadastrar impressora"
          descricao="Os valores já vêm preenchidos para a ZD220."
          acao={criarImpressora}
          botao="Cadastrar impressora"
        >
          <Campo id="imp-nome" rotulo="Nome" nome="nome" obrigatorio />
          <label
            htmlFor="imp-estacao"
            className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
          >
            Estação
          </label>
          {/*
            Obrigatória, e sem opção vazia: a impressão é roteada PELA bancada.
            Impressora sem bancada aceita token e aceita agente, mas nunca
            recebe trabalho — bancada montada, agente rodando, nada saindo.
          */}
          <select
            id="imp-estacao"
            name="estacao"
            required
            defaultValue=""
            disabled={bancadas.length === 0}
            className="mb-3 w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px] disabled:text-suave"
          >
            <option value="" disabled>
              {bancadas.length === 0
                ? "cadastre uma estação primeiro"
                : "escolha a bancada"}
            </option>
            {bancadas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
          <Campo
            id="imp-modelo"
            rotulo="Modelo"
            nome="modelo"
            valor="Zebra ZD220"
          />
          <div className="grid grid-cols-3 gap-2">
            <Campo id="imp-dpi" rotulo="DPI" nome="dpi" valor="203" />
            <Campo
              id="imp-largura"
              rotulo="Largura mm"
              nome="largura"
              valor="104"
            />
            <Campo
              id="imp-ling"
              rotulo="Linguagem"
              nome="linguagem"
              valor="zpl"
            />
          </div>
          <input type="hidden" name="conexao" value="usb" />
        </Formulario>
      </div>

      <section className="rounded-[9px] border border-linha px-4 py-[14px]">
        <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">
          O agente ainda não existe
        </h3>
        <p className="mt-2 max-w-[86ch] text-[13px] leading-relaxed text-suave">
          Esta aba já cadastra a impressora, emite o token e mostra a fila — mas
          o programa que roda na máquina da bancada ainda não foi escrito.
          Enquanto ele não existir, nenhuma impressora vai ficar online, e a
          conferência vai recusar a impressão. Está assim de propósito: preferi
          mostrar &ldquo;offline&rdquo; do que inventar um verde que não
          corresponde a nada.
        </p>
      </section>
    </div>
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

function Formulario({
  titulo,
  descricao,
  acao,
  botao,
  children,
}: {
  titulo: string;
  descricao: string;
  acao: (formData: FormData) => Promise<void>;
  botao: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={acao}
      className="rounded-[9px] border border-linha px-4 py-[14px]"
    >
      <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">{titulo}</h3>
      <p className="mb-3 mt-1 text-[12.5px] text-suave">{descricao}</p>
      {children}
      <button
        type="submit"
        className="mt-1 rounded-lg bg-tinta px-4 py-[9px] text-[13px] font-semibold text-white"
      >
        {botao}
      </button>
    </form>
  );
}

function Campo({
  id,
  rotulo,
  nome,
  valor,
  dica,
  obrigatorio,
}: {
  id: string;
  rotulo: string;
  nome: string;
  valor?: string;
  dica?: string;
  obrigatorio?: boolean;
}) {
  return (
    <div className="mb-3">
      <label
        htmlFor={id}
        className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
      >
        {rotulo}
      </label>
      <input
        id={id}
        name={nome}
        defaultValue={valor}
        placeholder={dica}
        required={obrigatorio}
        className="w-full rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px] outline-none focus-visible:border-tinta"
      />
    </div>
  );
}

function Selo({
  tom,
  children,
}: {
  tom: "ok" | "critico" | "neutro";
  children: React.ReactNode;
}) {
  const estilo =
    tom === "ok"
      ? "bg-ok-bg text-ok border-ok-linha"
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
