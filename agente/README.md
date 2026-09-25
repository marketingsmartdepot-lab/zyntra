# Agente de impressão do ZYNTRA

Roda na máquina da bancada, ligada por USB na Zebra.

Existe porque **navegador não fala com impressora USB** e a ZD220 não tem
rede — não há como imprimir a partir do servidor.

## Instalar numa máquina do galpão

Copie para o computador da bancada os dois arquivos — `ZyntraAgente.exe` e
`instalar.ps1` — e rode o instalador (botão direito, **Executar com o
PowerShell**). Não precisa de Node instalado na bancada: o executável já traz
tudo dentro.

O instalador copia o agente, faz o login e registra para abrir sozinho toda vez
que alguém entrar no Windows.

### De onde vem o .exe

Ele é compilado no Windows, pelo workflow **Agente de impressão** na aba
Actions do repositório — binário de Windows montado no Mac é binário que
ninguém abriu antes de entregar. O workflow roda sozinho a cada mudança na
pasta `agente/`, confere que o executável abre e publica o arquivo em
*Artifacts*, no fim da página da execução.

### Durante o desenvolvimento

Com Node 20 ou mais novo, `npm start` roda o mesmo agente pelo código-fonte, e
`npm run empacotar` gera o executável do sistema em que você está.

## O login

Na primeira vez ele pede **o e-mail e a senha do ZYNTRA** — os mesmos que a
pessoa usa no sistema. Com isso ele registra a máquina e recebe uma credencial
**do computador**, que é o que fica guardado em `~/.zyntra/agente.json`.

A senha não é gravada em lugar nenhum. Se a máquina for trocada, roubada ou
aposentada, remove-se a máquina no ZYNTRA e a credencial dela morre — ninguém
precisa mudar de senha.

## O que acontece depois

O agente manda a lista de impressoras que o sistema operacional enxerga. Elas
aparecem em **Integração → Estações e impressoras**, e é lá que se diz qual é a
térmica de cada bancada.

Ninguém digita nome de impressora. Nome digitado errado não imprime e falha
calado — foi o que essa mudança resolveu.

Se você instalar uma impressora nova depois, reinicie o agente: a lista é
enviada ao iniciar.

## Como ele imprime

O ZPL vai cru para o spooler, pelo nome da impressora.

- **Windows** — chama o `winspool.drv` pelo PowerShell que já vem no sistema.
  Não é preciso compartilhar a impressora na rede.
- **macOS e Linux** — `lp -o raw`.

## O que ele não faz

Não fala com o Mercado Livre nem com o Bling. Quem busca a etiqueta é o
servidor, que tem as credenciais; o agente recebe texto pronto. Assim nenhum
segredo de canal chega à máquina do galpão.

E "impressa" aqui significa **comando aceito pela impressora**. A prova de que
saiu papel continua sendo o operador bipar a etiqueta impressa.
