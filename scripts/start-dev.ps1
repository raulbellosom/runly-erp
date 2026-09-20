param()

$ErrorActionPreference = 'Stop'

$sshHost = $env:RUNLY_SSH_HOST
$localPort = if ($env:RUNLY_DB_LOCAL_PORT) { [int]$env:RUNLY_DB_LOCAL_PORT } else { 54322 }
$remoteAddr = $env:RUNLY_DB_REMOTE_ADDR
if (-not $sshHost -or -not $remoteAddr) {
  throw 'Set RUNLY_SSH_HOST and RUNLY_DB_REMOTE_ADDR in your shell before starting. See docs/06_deployment_strategy.md.'
}
$tunnelOwned = $false

function Test-TunnelPort {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    if (-not $ok) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Stop-Tunnel {
  param([int]$Port)
  $matches = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" |
    Where-Object { $_.CommandLine -match "-L\s*127\.0\.0\.1:${Port}:" }

  foreach ($p in $matches) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

$existingTunnel = Test-TunnelPort -Port $localPort

if ($existingTunnel) {
  Write-Host "Port $localPort already bound - tunnel already running, skipping."
} else {
  Write-Host "Opening SSH tunnel: 127.0.0.1:$localPort -> $remoteAddr ..."
  Write-Host 'If prompted, enter your SSH password once.'

  & ssh -f -N -o ServerAliveInterval=60 -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes -L "127.0.0.1:${localPort}:${remoteAddr}" $sshHost
  if ($LASTEXITCODE -ne 0) { throw 'SSH tunnel failed.' }

  Start-Sleep -Seconds 2

  if (-not (Test-TunnelPort -Port $localPort)) {
    throw "SSH tunnel did not start. Check SSH access to $sshHost."
  }

  Write-Host 'SSH tunnel ready.'
  $tunnelOwned = $true
}

Write-Host 'Starting dev servers (API + web + worker)...'
try {
  & pnpm.cmd dev
} finally {
  if ($tunnelOwned) {
    Write-Host 'Closing SSH tunnel...'
    Stop-Tunnel -Port $localPort
  }
  Write-Host 'Runly ERP dev environment stopped.'
}
