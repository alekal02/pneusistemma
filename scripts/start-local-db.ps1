# Sobe o Postgres de desenvolvimento (porta 5434) usado pela API local.
$ErrorActionPreference = "Stop"
$Name = "pneusistemma-pg"

$exists = docker ps -a --filter "name=^/${Name}$" --format "{{.Names}}"
if (-not $exists) {
  Write-Host ">> Criando container $Name..."
  docker run -d --name $Name --restart unless-stopped `
    -e POSTGRES_USER=pneu `
    -e POSTGRES_PASSWORD=pneu123 `
    -e POSTGRES_DB=pneusistemma `
    -p 5434:5432 postgres:16 | Out-Null
} else {
  docker update --restart unless-stopped $Name | Out-Null
  $running = docker ps --filter "name=^/${Name}$" --format "{{.Names}}"
  if (-not $running) {
    Write-Host ">> Iniciando $Name..."
    docker start $Name | Out-Null
  }
}

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  docker exec $Name pg_isready -U pneu -d pneusistemma 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ok) { throw "Postgres $Name nao ficou pronto na porta 5434." }
Write-Host ">> Postgres local ok em localhost:5434"
