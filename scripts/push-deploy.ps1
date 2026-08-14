# Sincroniza o monorepo com os repositórios que a Vercel e o Render realmente usam.
#   frontend/ -> https://github.com/alekal02/pneusistemma-frontend  (Vercel)
#   backend/  -> https://github.com/alekal02/pneusistemma-backend   (Render)
#
# Uso (na raiz do projeto):
#   powershell -File scripts/push-deploy.ps1
#   powershell -File scripts/push-deploy.ps1 -Message "sua mensagem"

param(
  [string]$Message = "Atualiza deploy Vercel/Render a partir do monorepo."
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$AuthorName = "alekal02"
$AuthorEmail = "alekal02@users.noreply.github.com"

function Sync-SplitRepo {
  param(
    [string]$Name,
    [string]$Src,
    [string]$RepoUrl,
    [string[]]$ExcludeDirs
  )

  $tmp = Join-Path $env:TEMP "pneusistemma-$Name-deploy"
  if (Test-Path $tmp) {
    Remove-Item $tmp -Recurse -Force
  }

  Write-Host ">> Clonando $Name..."
  git clone --depth 1 $RepoUrl $tmp
  if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar $RepoUrl" }

  $xd = @(".git", "node_modules", "dist") + $ExcludeDirs
  $robocopyArgs = @($Src, $tmp, "/E", "/XF", ".env", "/NFL", "/NDL", "/NJH", "/NJS")
  foreach ($d in $xd) { $robocopyArgs += @("/XD", $d) }
  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar arquivos de $Src" }

  git -C $tmp add -A
  git -C $tmp diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host ">> $Name`: sem alterações de conteúdo."
    return
  }

  git -C $tmp -c user.name=$AuthorName -c user.email=$AuthorEmail commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw "Falha no commit de $Name" }

  git -C $tmp push origin HEAD
  if ($LASTEXITCODE -ne 0) { throw "Falha no push de $Name" }

  Write-Host ">> $Name enviado para $RepoUrl"
}

Sync-SplitRepo -Name "frontend" -Src (Join-Path $Root "frontend") -RepoUrl "https://github.com/alekal02/pneusistemma-frontend.git" -ExcludeDirs @()
Sync-SplitRepo -Name "backend" -Src (Join-Path $Root "backend") -RepoUrl "https://github.com/alekal02/pneusistemma-backend.git" -ExcludeDirs @("data", "logs")

Write-Host "Pronto. Vercel (frontend) e Render (backend) devem iniciar o deploy."
