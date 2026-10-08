# Testa a publicacao em simulacao e as travas, sem clone, push, health real ou banco.
$ErrorActionPreference = "Stop"
$ScriptPath = Join-Path $PSScriptRoot "push-deploy.ps1"
$BaselinePath = Join-Path $PSScriptRoot "deploy-baselines.json"
$failures = @()

function Assert-True {
  param([bool]$Condition, [string]$Label)
  if (-not $Condition) { $script:failures += $Label }
}

function Invoke-DeployScript {
  param([string[]]$ArgList)
  $output = & powershell -NoProfile -File $ScriptPath @ArgList 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $output }
}

$confirmed = @(
  "-Simular",
  "-BackupNeon", "VERIFICADO",
  "-FrontendUrl", "https://pneusistemma-frontend.vercel.app",
  "-CorsOrigin", "https://pneusistemma-frontend.vercel.app",
  "-ViteApiUrl", "https://pneusistemma-backend.onrender.com/api"
)

$beforeBaseline = Get-FileHash $BaselinePath
$tempBefore = @(Get-ChildItem $env:TEMP -Directory -Filter "pneusistemma-*-deploy" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)

$missing = Invoke-DeployScript @("-Simular")
Assert-True ($missing.Code -ne 0) "simulacao sem backup deve falhar"
Assert-True ($missing.Out -match "backup") "simulacao sem backup explica o bloqueio"
Assert-True ($missing.Out -notmatch "Clonando") "simulacao sem backup nao clona"
Assert-True ($missing.Out -notmatch "Publicaria o frontend") "simulacao sem backup nao chega no frontend"

$badApi = Invoke-DeployScript @(
  "-Simular", "-BackupNeon", "VERIFICADO",
  "-FrontendUrl", "https://pneusistemma-frontend.vercel.app",
  "-CorsOrigin", "https://pneusistemma-frontend.vercel.app",
  "-ViteApiUrl", "http://localhost:3000/api"
)
Assert-True ($badApi.Code -ne 0) "VITE_API_URL invalida deve falhar"
Assert-True ($badApi.Out -match "VITE_API_URL") "erro cita VITE_API_URL"
Assert-True ($badApi.Out -notmatch "Clonando") "URL invalida nao clona"

$ok = Invoke-DeployScript $confirmed
Assert-True ($ok.Code -eq 0) "simulacao confirmada deve passar"
Assert-True ($ok.Out -match "SIMULACAO") "simulacao se identifica"
Assert-True ($ok.Out -match "Rollback") "simulacao mostra rollback"
Assert-True ($ok.Out -match "Render") "rollback cita Render"
Assert-True ($ok.Out -match "Vercel") "rollback cita Vercel"
Assert-True ($ok.Out -match "Neon") "rollback cita o banco"
$backendAt = $ok.Out.IndexOf("1. Publicaria o backend")
$frontendAt = $ok.Out.IndexOf("3. So entao publicaria o frontend")
Assert-True ($backendAt -ge 0 -and $frontendAt -gt $backendAt) "backend vem antes do frontend"
Assert-True ($ok.Out -notmatch "Clonando") "simulacao nao clona"
Assert-True ($ok.Out -notmatch "enviado para") "simulacao nao envia"

foreach ($falha in @("push", "health", "exclusivo")) {
  $run = Invoke-DeployScript ($confirmed + @("-SimularFalha", $falha))
  Assert-True ($run.Code -ne 0) "falha simulada $falha deve parar"
  Assert-True ($run.Out -match "Frontend cancelado|nao sera publicado") "falha $falha impede o frontend"
  Assert-True ($run.Out -notmatch "3\. So entao publicaria o frontend") "falha $falha nao publica o frontend"
  Assert-True ($run.Out -notmatch "Clonando") "falha $falha nao clona"
}

$afterBaseline = Get-FileHash $BaselinePath
Assert-True ($beforeBaseline.Hash -eq $afterBaseline.Hash) "simulacao nao altera a baseline"
$tempAfter = @(Get-ChildItem $env:TEMP -Directory -Filter "pneusistemma-*-deploy" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
Assert-True (($tempAfter -join "|") -eq ($tempBefore -join "|")) "simulacao nao cria pasta de deploy"

. $ScriptPath -SomenteFuncoes

$order = @()
try {
  Invoke-DeploySequence -PublishBackend { $script:order += "be"; throw "push do backend" } -CheckHealth { $script:order += "health" } -PublishFrontend { $script:order += "fe" }
} catch { }
Assert-True (($order -join ",") -eq "be") "push do backend interrompe antes do health e do frontend"

$order = @()
try {
  Invoke-DeploySequence -PublishBackend { $script:order += "be" } -CheckHealth { $script:order += "health"; throw "health" } -PublishFrontend { $script:order += "fe" }
} catch { }
Assert-True (($order -join ",") -eq "be,health") "health ruim interrompe antes do frontend"

$order = @()
Invoke-DeploySequence -PublishBackend { $script:order += "be" } -CheckHealth { $script:order += "health" } -PublishFrontend { $script:order += "fe" }
Assert-True (($order -join ",") -eq "be,health,fe") "sequencia feliz e backend, health, frontend"

$sleeps = 0
try {
  Wait-BackendHealth -Url "http://exemplo.test/api/health" -ExpectedSha "abc123" -MaxAttempts 2 -Sleep { param($Seconds) $script:sleeps += 1 } -Fetch {
    param($Url)
    return [pscustomobject]@{ status = "ok"; database = "postgresql"; commit = "antigo" }
  }
  Assert-True $false "health com commit antigo deve falhar"
} catch {
  Assert-True ($_.Exception.Message -match "Frontend cancelado") "health antigo cancela o frontend"
}
Assert-True ($sleeps -eq 1) "health antigo tenta de novo antes de desistir"

Wait-BackendHealth -Url "http://exemplo.test/api/health" -ExpectedSha "ABC123" -MaxAttempts 1 -Sleep { param($Seconds) } -Fetch {
  param($Url)
  return [pscustomobject]@{ status = "ok"; database = "postgresql"; commit = "abc123" }
}

$repo = Join-Path $env:TEMP ("pneu-guard-" + [guid]::NewGuid().ToString("n"))
$src = Join-Path $env:TEMP ("pneu-src-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path $repo, $src | Out-Null
try {
  git -C $repo init -q
  git -C $repo -c user.name=teste -c user.email=teste@example.com commit -q --allow-empty -m "base"
  Set-Content -Path (Join-Path $repo "keep.js") -Value "remoto" -Encoding ascii
  Set-Content -Path (Join-Path $repo "shared.js") -Value "antes" -Encoding ascii
  git -C $repo add keep.js shared.js
  git -C $repo -c user.name=teste -c user.email=teste@example.com commit -q -m "arquivos"
  $baseline = (git -C $repo rev-parse HEAD).Trim()
  Assert-NoExclusiveCommits -RepoDir $repo -Baseline $baseline -Name "backend"
  Set-Content -Path (Join-Path $repo "keep.js") -Value "exclusivo" -Encoding ascii
  git -C $repo add keep.js
  git -C $repo -c user.name=teste -c user.email=teste@example.com commit -q -m "so no deploy"
  $threw = $false
  try { Assert-NoExclusiveCommits -RepoDir $repo -Baseline $baseline -Name "backend" } catch { $threw = $true }
  Assert-True $threw "commit exclusivo bloqueia a publicacao"
  Assert-True ((Get-Content (Join-Path $repo "keep.js") -Raw).Trim() -eq "exclusivo") "o bloqueio nao apaga o arquivo exclusivo"

  Set-Content -Path (Join-Path $src "shared.js") -Value "monorepo" -Encoding ascii
  Set-Content -Path (Join-Path $repo "shared.js") -Value "monorepo" -Encoding ascii
  Remove-Item (Join-Path $repo "keep.js")
  git -C $repo add -A
  $kept = @(Protect-RemoteOnlyFiles -Src $src -RepoDir $repo)
  Assert-True ($kept -contains "keep.js") "arquivo ausente no monorepo e preservado"
  Assert-True (Test-Path (Join-Path $repo "keep.js")) "keep.js voltou ao worktree"
  $deleted = @(git -C $repo diff --cached --name-only --diff-filter=D)
  Assert-True ($deleted.Count -eq 0 -or -not $deleted[0]) "delecao do arquivo exclusivo sai do stage"
  $staged = @(git -C $repo diff --cached --name-only)
  Assert-True ($staged -contains "shared.js") "arquivo do monorepo continua no stage"
} finally {
  Remove-Item $repo, $src -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
  Write-Host "FALHAS:"
  $failures | ForEach-Object { Write-Host " - $_" }
  exit 1
}

Write-Host "OK: simulacao, health, commit exclusivo e arquivo remoto."
exit 0
