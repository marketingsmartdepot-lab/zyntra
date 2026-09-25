# Instala o agente de impressão do ZYNTRA nesta máquina.
#
# Rode com clique direito > "Executar com o PowerShell", ou:
#   powershell -ExecutionPolicy Bypass -File instalar.ps1
#
# O que ele faz, nesta ordem:
#   1. copia o executável para a pasta do usuário
#   2. abre o agente para você entrar com e-mail e senha do ZYNTRA
#   3. registra para abrir sozinho toda vez que alguém entrar no Windows

$ErrorActionPreference = "Stop"

$destino = Join-Path $env:LOCALAPPDATA "ZYNTRA"
$exe     = Join-Path $destino "ZyntraAgente.exe"
$origem  = Join-Path $PSScriptRoot "ZyntraAgente.exe"
$tarefa  = "ZYNTRA - Agente de impressao"

if (-not (Test-Path $origem)) {
  Write-Host ""
  Write-Host "  Nao encontrei ZyntraAgente.exe nesta pasta." -ForegroundColor Red
  Write-Host "  O instalador precisa estar na mesma pasta do executavel."
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  Instalando o agente de impressao do ZYNTRA" -ForegroundColor Cyan
Write-Host ""

# 1 --------------------------------------------------------------- copiar
New-Item -ItemType Directory -Force -Path $destino | Out-Null

# Arquivo que veio da internet chega com uma marca, e o Windows barra o
# executavel com um aviso de tela azul ("Windows protegeu o seu PC"). Tirar a
# marca antes de copiar evita esse susto no galpao.
Unblock-File -Path $origem -ErrorAction SilentlyContinue

# Se já estiver rodando, precisa parar antes: arquivo em uso não se sobrescreve.
Get-Process -Name "ZyntraAgente" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400

Copy-Item $origem $exe -Force
Write-Host "  [1/3] copiado para $destino"

# 2 ------------------------------------------------------------- primeiro uso
Write-Host "  [2/3] entrando no ZYNTRA"
Write-Host ""

$config = Join-Path $env:USERPROFILE ".zyntra\agente.json"
if (Test-Path $config) {
  Write-Host "        esta maquina ja esta registrada — pulando o login."
} else {
  # Na mesma janela, porque o agente pergunta e-mail e senha aqui. Com
  # --registrar ele faz o login, manda a lista de impressoras e sai; sem isso
  # entraria no laco de impressao e a instalacao nunca terminaria.
  & $exe --registrar
  if (-not (Test-Path $config)) {
    Write-Host ""
    Write-Host "  O login nao foi concluido. Nada foi agendado." -ForegroundColor Red
    Write-Host "  Rode o instalador de novo quando quiser tentar."
    Write-Host ""
    exit 1
  }
}

# 3 ------------------------------------------------------------ abrir sozinho
# Tarefa agendada em vez de servico do Windows: o agente guarda a credencial na
# pasta do usuario, e servico roda como SYSTEM, que tem outra pasta. Ao entrar
# no Windows a credencial certa esta no lugar certo.
schtasks /Delete /TN "$tarefa" /F 2>$null | Out-Null
schtasks /Create /TN "$tarefa" /TR "`"$exe`"" /SC ONLOGON /RL LIMITED /F | Out-Null
Write-Host "  [3/3] vai abrir sozinho quando alguem entrar no Windows"

Start-Process -FilePath $exe -WindowStyle Minimized

Write-Host ""
Write-Host "  Pronto." -ForegroundColor Green
Write-Host "  Agora abra o ZYNTRA em Integracao > Estacoes e impressoras:"
Write-Host "  esta maquina e as impressoras dela ja devem estar la."
Write-Host ""
