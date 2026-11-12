# Worker persistente de Radex (un solo proceso de PowerShell que se queda abierto).
# Protocolo por stdin/stdout, una línea por mensaje:
#   entrada : base64( JSON UTF-8 )   { t:'load', id, code }  |  { t:'req', id, cmd, args }
#   salida  : "@@ELIX@@" + base64( JSON UTF-8 )   { id, ok, data | error }
# Solo ejecuta comandos de la tabla $global:ELIX_H (definidos en archivos propios de native/).
# Compatible con Windows PowerShell 5.1: sin ?. ni ?? ni -AsHashtable.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$global:ELIX_H = @{}

function Send-Msg($o) {
  $json = ConvertTo-Json -InputObject $o -Depth 8 -Compress
  $b64 = [Convert]::ToBase64String($utf8.GetBytes($json))
  [Console]::Out.WriteLine('@@ELIX@@' + $b64)
  [Console]::Out.Flush()
}

# ---- Comandos básicos (diagnóstico) ----
$global:ELIX_H['ping'] = {
  param($a)
  @{
    pong = $true
    psVersion = $PSVersionTable.PSVersion.ToString()
    mode = [string]$ExecutionContext.SessionState.LanguageMode
    bits64 = [bool][Environment]::Is64BitProcess
    os = [Environment]::OSVersion.Version.ToString()
    culture = (Get-Culture).Name
  }
}

$global:ELIX_H['echo'] = {
  param($a)
  @{ text = [string]$a.text; len = ([string]$a.text).Length }
}

# ¿Se puede compilar C# con Add-Type? (lo necesitan los módulos de audio)
$global:ELIX_H['selfcheck'] = {
  param($a)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    if (-not ('ElixProbe' -as [type])) {
      Add-Type -TypeDefinition 'public class ElixProbe { public static int Two() { return 2; } }'
    }
    @{ addType = ([ElixProbe]::Two() -eq 2); ms = [int]$sw.ElapsedMilliseconds }
  } catch {
    @{ addType = $false; ms = [int]$sw.ElapsedMilliseconds; error = [string]$_.Exception.Message }
  }
}

# Solo para probar el tiempo de espera y el reinicio del worker (máximo 60 s)
$global:ELIX_H['sleep'] = {
  param($a)
  $ms = [Math]::Min(60000, [Math]::Max(0, [int]$a.ms))
  Start-Sleep -Milliseconds $ms
  @{ slept = $ms }
}

# ---- Bucle principal ----
$stdin = [Console]::In
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }
  $id = $null
  try {
    $msg = ConvertFrom-Json ($utf8.GetString([Convert]::FromBase64String($line)))
    $id = $msg.id
    if ($msg.t -eq 'load') {
      . ([scriptblock]::Create([string]$msg.code))
      Send-Msg @{ id = $id; ok = $true; data = $null }
    } elseif ($msg.t -eq 'req') {
      $h = $global:ELIX_H[[string]$msg.cmd]
      if ($null -eq $h) { throw ('comando desconocido: ' + [string]$msg.cmd) }
      $r = & $h $msg.args
      Send-Msg @{ id = $id; ok = $true; data = $r }
    } else {
      throw 'mensaje no válido'
    }
  } catch {
    Send-Msg @{ id = $id; ok = $false; error = [string]$_.Exception.Message }
  }
}
