-- A tela de turno foi apagada. Ela existia para alguém dizer "sou eu nesta
-- bancada" com PIN, de quando a conferência se identificava por PIN. A
-- conferência passou a ser por login, então o turno ficou sem função.
--
-- As funções saem do alcance de quem chama pela API. Não as removo nem apago a
-- tabela: `conferencias.sessao_id` aponta para sessoes_estacao, e derrubar isso
-- exigiria mexer no histórico de conferências só para apagar uma palavra.
--
-- O que CONTINUA valendo é a ESTAÇÃO: qual máquina é qual bancada, que é o que
-- decide em qual impressora a etiqueta sai. Isso é cookie no navegador e não
-- depende de turno nenhum.
revoke execute on function public.abrir_sessao_estacao(uuid, uuid, text)
  from authenticated, anon, public;
revoke execute on function public.encerrar_sessao_estacao(uuid)
  from authenticated, anon, public;

comment on function public.abrir_sessao_estacao(uuid, uuid, text) is
  'APOSENTADA. O turno de PIN na bancada deixou de existir: quem confere se '
  'identifica por login. O PIN vale só na lista de separação, na bipagem da '
  'porta e na liberação de divergência.';

comment on function public.encerrar_sessao_estacao(uuid) is
  'APOSENTADA junto com abrir_sessao_estacao.';
