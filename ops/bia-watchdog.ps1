# =============================================================================
# BIA Watchdog — mantém UMA instância da BIA (app de estoque) no ar.
#  - Sobe a BIA se estiver fora do ar (porta 3001 sem resposta).
#  - Reinicia se o processo estiver vivo mas TRAVADO (não responde) por 2 ciclos.
#  - Reinicia se o WhatsApp cair de vez (state=ERROR / whatsappStatus=disconnected) por 2 ciclos.
#  - Garante instância única (mata duplicatas da BIA).
#  - ESCOPO SEGURO: só mexe em processos da BIA (node src/index.js deste projeto) e no
#    Chrome cujo perfil é o .wwebjs_auth deste projeto. NUNCA toca no n8n.
#
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File bia-watchdog.ps1 [-DryRun]
# =============================================================================
param([switch]$DryRun)

$ProjectDir = 'C:\Users\usuario001\Documents\api_consulta_estoque'
$StatusUrl  = 'http://localhost:3001/api/status'
$LogFile    = Join-Path $ProjectDir 'logs\watchdog.log'
$StateFile  = Join-Path $ProjectDir 'data\watchdog_state.json'
$ProjTag    = 'api_consulta_estoque'   # marca do projeto no command line (isola do n8n)
$NodeExe    = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $NodeExe) { $NodeExe = 'node' }

function Log($m) {
    $line = "[{0}]{1} {2}" -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'), $(if($DryRun){' [DRYRUN]'}else{''}), $m
    try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
    Write-Output $line
}
function Get-BiaNode  { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'"   -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'src[\\/]index\.js' }) }
function Get-BiaChrome{ @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match [regex]::Escape($ProjTag) }) }
function Stop-Bia {
    if ($DryRun) { Log 'Stop-Bia (simulado)'; return }
    Get-BiaNode   | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Seconds 2
    Get-BiaChrome | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Seconds 2
}
function Start-Bia {
    if ($DryRun) { Log 'Start-Bia (simulado)'; return }
    Start-Process -FilePath $NodeExe -ArgumentList 'src/index.js' -WorkingDirectory $ProjectDir -WindowStyle Hidden
}

# Estado (contador de ciclos não-saudáveis consecutivos)
$state = @{ unhealthy = 0 }
if (Test-Path $StateFile) { try { $j = Get-Content $StateFile -Raw | ConvertFrom-Json; if ($j.unhealthy) { $state.unhealthy = [int]$j.unhealthy } } catch {} }

# Flag de restart sob demanda: crie o arquivo data\watchdog_restart.flag para pedir
# um restart limpo da BIA (usado para aplicar código novo, já que a BIA roda elevada
# pela tarefa e não pode ser encerrada de sessões sem privilégio).
$RestartFlag = Join-Path $ProjectDir 'data\watchdog_restart.flag'
if (Test-Path $RestartFlag) {
    Log 'Flag de restart encontrada. Reiniciando BIA para aplicar codigo novo...'
    try { Remove-Item $RestartFlag -Force -ErrorAction Stop } catch {}
    Stop-Bia; Start-Sleep -Seconds 3; Start-Bia
    $state.unhealthy = 0
    try { ($state | ConvertTo-Json) | Set-Content -Path $StateFile -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
    exit 0
}

# Consulta de saúde
$resp = $null
try { $resp = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 6 -ErrorAction Stop } catch { $resp = $null }
$bia = Get-BiaNode

if ($null -eq $resp) {
    if ($bia.Count -eq 0) {
        Log 'BIA fora do ar (sem processo). Iniciando...'
        Start-Bia; $state.unhealthy = 0
    } else {
        $state.unhealthy++
        if ($state.unhealthy -ge 2) {
            Log ("BIA travada (nao responde) x{0}. Reiniciando..." -f $state.unhealthy)
            Stop-Bia; Start-Sleep -Seconds 3; Start-Bia; $state.unhealthy = 0
        } else {
            Log ("BIA nao respondeu (tentativa {0}/2); aguardando." -f $state.unhealthy)
        }
    }
} else {
    if ($bia.Count -gt 1) {
        # Multiplas instancias = sessao conflitada -> restart limpo para 1 instancia
        Log ("Multiplas instancias BIA ({0}) detectadas. Restart limpo para instancia unica..." -f $bia.Count)
        Stop-Bia; Start-Sleep -Seconds 3; Start-Bia; $state.unhealthy = 0
    } else {
        $wa = "$($resp.whatsappStatus)"; $st = "$($resp.state)"
        if ($st -eq 'ERROR' -or $wa -eq 'disconnected') {
            $state.unhealthy++
            if ($state.unhealthy -ge 2) {
                Log ("WhatsApp/estado ruim (state={0} wa={1}) x{2}. Reiniciando BIA..." -f $st, $wa, $state.unhealthy)
                Stop-Bia; Start-Sleep -Seconds 3; Start-Bia; $state.unhealthy = 0
            } else {
                Log ("BIA nao saudavel (state={0} wa={1}) tentativa {2}/2; aguardando reconexao interna." -f $st, $wa, $state.unhealthy)
            }
        } else {
            if ($state.unhealthy -gt 0) { Log ("BIA saudavel novamente (state={0} wa={1})." -f $st, $wa) }
            $state.unhealthy = 0
        }
    }
}

try { ($state | ConvertTo-Json) | Set-Content -Path $StateFile -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
