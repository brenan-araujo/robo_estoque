# =============================================================================
# Registra a Tarefa Agendada "BIA Watchdog" (mantem 1 instancia da BIA no ar).
#  - Roda no LOGON e A CADA 2 MINUTOS.
#  - Roda como usuario001, MESMO SEM NINGUEM LOGADO (sobrevive a logoff/reboot).
#  - A senha e pedida num prompt seguro e vai so para o cofre da Tarefa Agendada
#    do Windows (NAO fica salva neste arquivo).
#
# COMO USAR:
#   1) Abra o PowerShell COMO ADMINISTRADOR.
#   2) Execute:
#        powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\usuario001\Documents\api_consulta_estoque\ops\install-bia-watchdog.ps1"
#   3) No prompt, informe a senha do usuario001.
#
# Para remover:  Unregister-ScheduledTask -TaskName 'BIA Watchdog' -Confirm:$false
# =============================================================================
$ErrorActionPreference = 'Stop'
$TaskName = 'BIA Watchdog'
$Watchdog = 'C:\Users\usuario001\Documents\api_consulta_estoque\ops\bia-watchdog.ps1'

# Precisa ser Administrador para criar tarefa com senha / nivel elevado
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning 'Este script precisa rodar como ADMINISTRADOR. Abra o PowerShell com "Executar como administrador" e rode de novo.'
    exit 1
}

$cred = Get-Credential -UserName 'usuario001' -Message 'Senha do usuario001 (para a tarefa rodar mesmo sem logon)'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Watchdog)

$trigLogon  = New-ScheduledTaskTrigger -AtLogOn
$trigRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigLogon, $trigRepeat) `
    -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
    -RunLevel Highest -Description 'Mantem 1 instancia da BIA sempre no ar; reinicia se processo/WhatsApp cair. Roda mesmo sem logon. Nao toca no n8n.' -Force | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName
Write-Output ("OK. Tarefa '{0}' criada. Roda como {1} | LogonType {2} | RunLevel {3}." -f `
    $TaskName, $info.Principal.UserId, $info.Principal.LogonType, $info.Principal.RunLevel)
Write-Output 'Testando execucao...'
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 6
$r = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
Write-Output ("LastTaskResult = {0} (0 = sucesso)" -f $r)
