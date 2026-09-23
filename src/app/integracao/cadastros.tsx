import { criarClienteServidor } from "@/lib/supabase/server";
import {
  atualizarFaturador,
  criarCanal,
  criarEmpresa,
  criarModalidade,
  definirCusto,
} from "./cadastros-acoes";

type Empresa = {
  id: string;
  razao_social: string;
  nome_curto: string;
  cnpj: string | null;
  serie_nfe: string | null;
  faturador_situacao: string;
};

type Canal = {
  id: string;
  slug: string;
  nome: string;
  sigla: string | null;
  entra_na_esteira: boolean;
};

type Modalidade = {
  id: string;
  nome: string;
  slug: string;
  gera_etiqueta: boolean;
  exige_nota_antes: boolean;
  tem_janela_coleta: boolean;
  canais: { nome: string } | null;
};

type Custo = {
  id: string;
  valor: number;
  vigente_de: string;
  vigente_ate: string | null;
  modalidades: { nome: string } | null;
};

const FATURADOR = [
  { valor: "nao_configurado", rotulo: "Não configurado" },
  { valor: "em_teste", rotulo: "Em teste" },
  { valor: "ativo", rotulo: "Ativo" },
  { valor: "pausado", rotulo: "Pausado" },
];

/**
 * Os cadastros que o sistema lê e nunca teve onde criar.
 *
 * Sem empresa emissora nenhuma conta fatura; sem canal e modalidade nenhum
 * pedido se classifica; sem custo de etiqueta o fechamento do Flex soma zero.
 * São poucos e mudam raramente — por isso ficam juntos numa aba só, e não
 * espalhados pelo sistema.
 */
export async function Cadastros({ falha }: { falha?: string }) {
  const supabase = await criarClienteServidor();

  const [{ data: empresas }, { data: canais }, { data: modalidades }, { data: custos }] =
    await Promise.all([
      supabase
        .from("empresas")
        .select("id, razao_social, nome_curto, cnpj, serie_nfe, faturador_situacao")
        .order("nome_curto"),
      supabase
        .from("canais")
        .select("id, slug, nome, sigla, entra_na_esteira")
        .order("nome"),
      supabase
        .from("modalidades")
        .select(
          "id, nome, slug, gera_etiqueta, exige_nota_antes, tem_janela_coleta, canais ( nome )",
        )
        .order("nome"),
      supabase
        .from("custos_etiqueta")
        .select("id, valor, vigente_de, vigente_ate, modalidades ( nome )")
        .order("vigente_de", { ascending: false })
        .limit(20),
    ]);

  const listaEmpresas = (empresas ?? []) as Empresa[];
  const listaCanais = (canais ?? []) as Canal[];
  const listaModalidades = (modalidades ?? []) as unknown as Modalidade[];
  const listaCustos = (custos ?? []) as unknown as Custo[];

  return (
    <div className="flex flex-col gap-6 p-5">
      {falha && <Aviso resultado={falha} />}

      <Secao
        titulo="Empresas emissoras"
        explicacao="Quem emite a nota. Uma conta sem empresa emissora não fatura — o pedido para em Aberto dizendo faturador não configurado."
      >
        {listaEmpresas.length > 0 && (
          <Tabela cabecalhos={["Empresa", "CNPJ", "Série", "Faturador", ""]}>
            {listaEmpresas.map((e) => (
              <tr key={e.id}>
                <Celula>
                  <b className="font-semibold">{e.nome_curto}</b>
                  <span className="mt-[2px] block text-[11.5px] text-suave">
                    {e.razao_social}
                  </span>
                </Celula>
                <Celula mono>{e.cnpj ?? "—"}</Celula>
                <Celula mono>{e.serie_nfe ?? "—"}</Celula>
                <Celula>
                  {FATURADOR.find((f) => f.valor === e.faturador_situacao)
                    ?.rotulo ?? e.faturador_situacao}
                </Celula>
                <Celula>
                  <form
                    action={atualizarFaturador}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="empresa" value={e.id} />
                    <select
                      name="faturador"
                      defaultValue={e.faturador_situacao}
                      aria-label={`Situação do faturador de ${e.nome_curto}`}
                      className="rounded-lg border border-linha bg-superficie px-[9px] py-[6px] text-[12px]"
                    >
                      {FATURADOR.map((f) => (
                        <option key={f.valor} value={f.valor}>
                          {f.rotulo}
                        </option>
                      ))}
                    </select>
                    <input
                      name="serie_nfe"
                      defaultValue={e.serie_nfe ?? ""}
                      placeholder="série"
                      aria-label={`Série da NF-e de ${e.nome_curto}`}
                      className="w-[68px] rounded-lg border border-linha bg-superficie px-[9px] py-[6px] font-mono text-[12px]"
                    />
                    <Botao>Salvar</Botao>
                  </form>
                </Celula>
              </tr>
            ))}
          </Tabela>
        )}

        <form action={criarEmpresa} className="flex flex-wrap items-end gap-2">
          <Campo nome="razao_social" rotulo="Razão social" largura="240px" obrigatorio />
          <Campo nome="nome_curto" rotulo="Nome curto" largura="130px" obrigatorio />
          <Campo nome="cnpj" rotulo="CNPJ" largura="150px" mono />
          <Campo nome="serie_nfe" rotulo="Série" largura="70px" mono />
          <Botao principal>Cadastrar empresa</Botao>
        </form>
      </Secao>

      <Secao
        titulo="Canais"
        explicacao="De onde vem a venda. Fora da esteira é o caso do Full: a mercadoria está no galpão do Mercado Livre, então nada disso passa por aqui."
      >
        {listaCanais.length > 0 && (
          <Tabela cabecalhos={["Canal", "Identificador", "Sigla", "Esteira"]}>
            {listaCanais.map((c) => (
              <tr key={c.id}>
                <Celula>
                  <b className="font-semibold">{c.nome}</b>
                </Celula>
                <Celula mono>{c.slug}</Celula>
                <Celula mono>{c.sigla ?? "—"}</Celula>
                <Celula>{c.entra_na_esteira ? "Entra" : "Fora"}</Celula>
              </tr>
            ))}
          </Tabela>
        )}

        <form action={criarCanal} className="flex flex-wrap items-end gap-2">
          <Campo nome="nome" rotulo="Nome" largura="180px" obrigatorio />
          <Campo nome="slug" rotulo="Identificador" largura="150px" mono obrigatorio />
          <Campo nome="sigla" rotulo="Sigla" largura="80px" mono />
          <Campo nome="icone_url" rotulo="Ícone" largura="200px" dica="/canais/arquivo.svg" />
          <Marcar nome="entra_na_esteira" rotulo="Entra na esteira" marcado />
          <Botao principal>Cadastrar canal</Botao>
        </form>
      </Secao>

      <Secao
        titulo="Modalidades de envio"
        explicacao="Três chaves mudam o comportamento da esteira: se gera etiqueta, se exige a nota antes de separar, e se tem janela de coleta."
      >
        {listaModalidades.length > 0 && (
          <Tabela
            cabecalhos={["Modalidade", "Canal", "Etiqueta", "Nota antes", "Coleta"]}
          >
            {listaModalidades.map((m) => (
              <tr key={m.id}>
                <Celula>
                  <b className="font-semibold">{m.nome}</b>
                  <span className="mt-[2px] block font-mono text-[11px] text-suave">
                    {m.slug}
                  </span>
                </Celula>
                <Celula>{m.canais?.nome ?? "—"}</Celula>
                <Celula>{m.gera_etiqueta ? "Gera" : "Não gera"}</Celula>
                <Celula>{m.exige_nota_antes ? "Sim" : "Não"}</Celula>
                <Celula>{m.tem_janela_coleta ? "Tem janela" : "Contínua"}</Celula>
              </tr>
            ))}
          </Tabela>
        )}

        {listaCanais.length === 0 ? (
          <p className="m-0 text-[12.5px] text-suave">
            Cadastre um canal primeiro — toda modalidade pertence a um.
          </p>
        ) : (
          <form action={criarModalidade} className="flex flex-wrap items-end gap-2">
            <Escolher nome="canal" rotulo="Canal" opcoes={listaCanais} />
            <Campo nome="nome" rotulo="Nome" largura="170px" obrigatorio />
            <Campo nome="slug" rotulo="Identificador" largura="150px" mono obrigatorio />
            <Marcar nome="gera_etiqueta" rotulo="Gera etiqueta" marcado />
            <Marcar nome="exige_nota_antes" rotulo="Nota antes" marcado />
            <Marcar nome="tem_janela_coleta" rotulo="Janela de coleta" />
            <Marcar nome="entra_na_esteira" rotulo="Entra na esteira" marcado />
            <Botao principal>Cadastrar modalidade</Botao>
          </form>
        )}
      </Secao>

      <Secao
        titulo="Custo da etiqueta"
        explicacao="Só o Flex tem custo. Trocar o valor abre uma vigência nova e fecha a anterior — nunca sobrescreve, porque o valor congelado numa saída antiga precisa continuar explicável no fechamento."
      >
        {listaCustos.length > 0 && (
          <Tabela cabecalhos={["Modalidade", "Valor", "Vigente de", "Até"]}>
            {listaCustos.map((c) => (
              <tr key={c.id} className={c.vigente_ate ? "opacity-60" : undefined}>
                <Celula>
                  <b className="font-semibold">{c.modalidades?.nome ?? "—"}</b>
                </Celula>
                <Celula mono>
                  {Number(c.valor).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </Celula>
                <Celula>{dia(c.vigente_de)}</Celula>
                <Celula>
                  {c.vigente_ate ? dia(c.vigente_ate) : "em vigor"}
                </Celula>
              </tr>
            ))}
          </Tabela>
        )}

        {listaModalidades.length === 0 ? (
          <p className="m-0 text-[12.5px] text-suave">
            Cadastre uma modalidade primeiro.
          </p>
        ) : (
          <form action={definirCusto} className="flex flex-wrap items-end gap-2">
            <Escolher nome="modalidade" rotulo="Modalidade" opcoes={listaModalidades} />
            <Campo nome="valor" rotulo="Valor" largura="110px" mono dica="ex.: 11,99" obrigatorio />
            <div>
              <label
                htmlFor="cad-vigente"
                className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
              >
                Vigente a partir de
              </label>
              <input
                id="cad-vigente"
                name="vigente_de"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
              />
            </div>
            <Botao principal>Definir valor</Botao>
          </form>
        )}
      </Secao>
    </div>
  );
}

function dia(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function Aviso({ resultado }: { resultado: string }) {
  const texto: Record<string, string> = {
    empresa_criada: "Empresa cadastrada.",
    empresa_salva: "Empresa atualizada.",
    canal_criado: "Canal cadastrado.",
    modalidade_criada: "Modalidade cadastrada.",
    custo_salvo: "Valor definido. A vigência anterior foi fechada.",
    valor_igual: "Esse já é o valor em vigor — nada mudou.",
    data_anterior_a_vigente:
      "A data escolhida é anterior à vigência atual. Isso reescreveria o passado: uma saída já registrada deixaria de bater com a tabela.",
    valor_invalido: "O valor precisa ser um número não negativo.",
    modalidade_nao_encontrada: "Esta modalidade não existe mais.",
    ja_existe: "Já existe um cadastro com esse identificador.",
    sem_permissao: "Só administrador faz cadastros.",
    erro: "Não foi possível concluir.",
  };

  const bom = [
    "empresa_criada",
    "empresa_salva",
    "canal_criado",
    "modalidade_criada",
    "custo_salvo",
    "valor_igual",
  ].includes(resultado);

  return (
    <p
      role="status"
      className={`m-0 rounded-lg border px-4 py-3 text-[12.5px] font-semibold ${
        bom
          ? "border-ok-linha bg-ok-bg text-ok"
          : "border-critico-linha bg-critico-bg text-critico"
      }`}
    >
      {texto[resultado] ?? texto.erro}
    </p>
  );
}

function Secao({
  titulo,
  explicacao,
  children,
}: {
  titulo: string;
  explicacao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[9px] border border-linha px-4 py-[14px]">
      <h3 className="m-0 text-[14px] font-bold tracking-[-0.01em]">{titulo}</h3>
      <p className="mb-4 mt-1 max-w-[74ch] text-[12.5px] leading-relaxed text-suave">
        {explicacao}
      </p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Tabela({
  cabecalhos,
  children,
}: {
  cabecalhos: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-[9px] border border-linha">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {cabecalhos.map((c, i) => (
              <th
                key={`${c}-${i}`}
                className="whitespace-nowrap border-b border-linha px-4 py-[10px] text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-suave"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Celula({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`border-b border-linha-suave px-4 py-[10px] align-middle text-[12.5px] ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}

function Campo({
  nome,
  rotulo,
  largura,
  dica,
  mono,
  obrigatorio,
}: {
  nome: string;
  rotulo: string;
  largura: string;
  dica?: string;
  mono?: boolean;
  obrigatorio?: boolean;
}) {
  const id = `cad-${nome}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
      >
        {rotulo}
      </label>
      <input
        id={id}
        name={nome}
        required={obrigatorio}
        placeholder={dica}
        style={{ width: largura }}
        className={`rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px] ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function Escolher({
  nome,
  rotulo,
  opcoes,
}: {
  nome: string;
  rotulo: string;
  opcoes: { id: string; nome: string }[];
}) {
  const id = `cad-${nome}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-[6px] block text-[10.5px] font-semibold uppercase tracking-[0.13em] text-suave"
      >
        {rotulo}
      </label>
      <select
        id={id}
        name={nome}
        required
        className="w-[170px] rounded-lg border border-linha bg-superficie px-3 py-[9px] text-[13.5px]"
      >
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </div>
  );
}

function Marcar({
  nome,
  rotulo,
  marcado,
}: {
  nome: string;
  rotulo: string;
  marcado?: boolean;
}) {
  const id = `cad-${nome}`;
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-[7px] py-[10px] text-[12.5px]"
    >
      <input
        id={id}
        type="checkbox"
        name={nome}
        defaultChecked={marcado}
        className="accent-[var(--color-tinta)]"
      />
      {rotulo}
    </label>
  );
}

function Botao({
  children,
  principal,
}: {
  children: React.ReactNode;
  principal?: boolean;
}) {
  return (
    <button
      type="submit"
      className={`rounded-lg px-4 py-[9px] text-[13px] font-semibold ${
        principal
          ? "bg-tinta text-white"
          : "border border-linha text-tinta"
      }`}
    >
      {children}
    </button>
  );
}
