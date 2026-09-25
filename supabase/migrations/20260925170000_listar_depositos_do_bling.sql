-- A lista de depósitos, vinda do Bling.
--
-- O id do depósito NÃO aparece na interface do Bling em lugar nenhum — a tela
-- de Depósitos mostra só descrição e um botão de desconsiderar saldo. O id só
-- existe na API. Pedir para a pessoa digitar um número que ela não tem como
-- descobrir era um campo impossível de preencher, e foi erro meu de desenho.
--
-- A Lexos resolve isso com uma lista, e é o que passa a acontecer aqui.
-- Precisa de conexão viva: listar depósito exige token.
--
-- A baixa já monta `deposito: {id: N}`, então é esse id que a lista entrega.

create or replace function public.listar_depositos_erp()
returns table (ok boolean, motivo text, detalhe text, depositos jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_expira timestamptz;
  v_resposta extensions.http_response;
  v_pagina integer := 1;
  v_lote jsonb;
  v_tudo jsonb := '[]'::jsonb;
  v_primeira text;
begin
  if not public.e_admin() then
    return query select false, 'so_admin', null::text, null::jsonb; return;
  end if;

  select c.access_token, c.expira_em into v_token, v_expira
  from privado.credenciais_erp c where c.id;

  if coalesce(v_token, '') = '' then
    return query select false, 'sem_conexao', null::text, null::jsonb; return;
  end if;

  if v_expira is not null and v_expira < now() then
    return query select false, 'conexao_expirada', null::text, null::jsonb; return;
  end if;

  -- Cinco páginas é folga larga para uma lista de depósitos. Sem o limite, um
  -- erro de paginação viraria laço infinito dentro do banco.
  while v_pagina <= 5 loop
    begin
      select * into v_resposta from extensions.http((
        'GET',
        'https://api.bling.com.br/Api/v3/depositos?pagina=' || v_pagina,
        array[
          extensions.http_header('Accept', 'application/json'),
          extensions.http_header('Authorization', 'Bearer ' || v_token)
        ],
        null, null
      )::extensions.http_request);
    exception when others then
      return query select false, 'rede', sqlerrm, null::jsonb; return;
    end;

    if v_pagina = 1 then
      v_primeira := left(coalesce(v_resposta.content, ''), 400);
    end if;

    if v_resposta.status < 200 or v_resposta.status > 299 then
      return query select false, 'recusado',
        'Bling respondeu ' || v_resposta.status || ': '
          || left(coalesce(v_resposta.content, ''), 400),
        null::jsonb;
      return;
    end if;

    v_lote := coalesce((v_resposta.content::jsonb) -> 'data', '[]'::jsonb);
    exit when jsonb_array_length(v_lote) = 0;

    v_tudo := v_tudo || v_lote;
    v_pagina := v_pagina + 1;
  end loop;

  if jsonb_array_length(v_tudo) = 0 then
    -- A resposta crua vai junto: se o formato mudar, dá para ver o que veio
    -- em vez de só "nenhum depósito".
    return query select false, 'nenhum_deposito', v_primeira, null::jsonb; return;
  end if;

  return query
  select true, 'ok', null::text,
    jsonb_agg(
      jsonb_build_object(
        'id', d ->> 'id',
        -- `descricao` é o campo esperado; `nome` fica de reserva porque não
        -- consegui ler a documentação literal deste recurso — o portal do
        -- Bling devolve 404 para leitura automatizada.
        'nome', coalesce(d ->> 'descricao', d ->> 'nome', 'sem nome'),
        'padrao', coalesce((d ->> 'padrao')::boolean, false)
      )
      order by coalesce(d ->> 'descricao', d ->> 'nome')
    )
  from jsonb_array_elements(v_tudo) d;
end;
$$;

comment on function public.listar_depositos_erp is
  'Os depositos do Bling, para a tela virar uma lista. O id do deposito so existe na API, nunca na interface do Bling.';

revoke all on function public.listar_depositos_erp() from public, anon;
grant execute on function public.listar_depositos_erp() to authenticated;
