# Agente de impressão do ZYNTRA

Roda na máquina da bancada. Existe porque **navegador não fala com impressora
USB** e a **Zebra ZD220 não tem rede** — não há como imprimir a partir do
servidor.

Uma instalação por bancada. Cada uma tem o seu token, e a etiqueta sai na
impressora daquela bancada.

## O que ele faz

1. Bate ponto — é isso que faz a tela dizer **online**. Sem batida recente, o
   ZYNTRA recusa a impressão em vez de fingir que mandou.
2. Reserva os próximos trabalhos **daquela** impressora.
3. Manda o ZPL cru para o spooler do sistema.
4. Diz se o comando foi aceito.

**O que ele não faz:** falar com o Mercado Livre. Quem busca a etiqueta é o
servidor, que tem o token do ML. O agente recebe texto pronto — assim o
segredo nunca chega numa máquina do galpão.

E **"impressa" significa comando aceito pela impressora**. A prova de que saiu
papel continua sendo o operador bipar a etiqueta.

## Instalar

Precisa de Node 20 ou mais novo. Não tem dependências.

```
cp .env.exemplo .env
```

Descubra o nome da impressora:

```
npm run impressoras
```

Preencha o `.env`:

- **TOKEN** — gerado no ZYNTRA, em *Integração → Estações e impressoras*.
  Aparece uma vez só.
- **IMPRESSORA** — no macOS e Linux, o nome que apareceu no comando acima. No
  Windows, o nome do **compartilhamento** da impressora.

Rode:

```
npm start
```

## Windows

O spooler do Windows não tem modo *raw* por linha de comando, então o agente
copia o arquivo direto para a impressora compartilhada. Para isso ela precisa
estar **compartilhada**:

*Configurações → Impressoras → ZD220 → Propriedades → Compartilhamento →
Compartilhar esta impressora*. O nome que você der ali é o que vai no `.env`.

## Deixar rodando sozinho

- **Windows:** Agendador de Tarefas, gatilho *ao fazer logon*, ação
  `node C:\zyntra\agente\agente.mjs`, iniciar em `C:\zyntra\agente`.
- **macOS:** um `launchd` plist em `~/Library/LaunchAgents` com `RunAtLoad` e
  `KeepAlive`.
- **Linux:** uma unit do systemd com `Restart=always`.

## Quando algo não imprime

A tela do ZYNTRA mostra o agente **offline** se ele parar de bater ponto por
mais de dois minutos. Nessa situação a impressão é recusada, com o motivo, em
vez de sumir.

Erro de impressão fica gravado no trabalho e aparece na fila — não se perde.
