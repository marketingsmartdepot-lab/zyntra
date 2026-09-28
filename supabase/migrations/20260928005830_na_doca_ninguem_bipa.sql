-- "nao vamos ter que bipar cada caixa do carrinho, so sera bipado quando sair
-- da doca para o caminhao".
--
-- `bipar_entrega_doca` foi construída antes de o carrinho virar a lista. Agora
-- o carrinho se enche sozinho ao finalizar cada conferência, e a seleção em
-- Pronto pra envio cobre a exceção. Ninguém bipa caixa entrando na doca.
--
-- A função sai do alcance de quem chama pela API. Não a removo: ela tem a
-- lógica de recusa que a seleção reaproveita conceitualmente, e apagar código
-- testado para reescrevê-lo igual daqui a um mês é desperdício. Mas deixar
-- executável seria manter uma porta que a operação não usa mais.
revoke execute on function public.bipar_entrega_doca(uuid, text) from authenticated, anon, public;

comment on function public.bipar_entrega_doca(uuid, text) is
  'APOSENTADA. Na doca ninguém bipa: o carrinho é a lista de separação e se '
  'enche sozinho ao finalizar a conferência. O único bipe do fluxo é na '
  'Estação de saída, quando a caixa vai da doca para o caminhão.';
