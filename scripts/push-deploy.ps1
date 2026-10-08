# Sincroniza o monorepo com os repositórios que a Vercel e o Render realmente usam.
#   backend/  -> https://github.com/alekal02/pneusistemma-backend   (Render, primeiro)
#   frontend/ -> https://github.com/alekal02/pneusistemma-frontend  (Vercel, só depois do health)
#
# Uso real (só depois do backup verificado no Neon):
#   powershell -File scripts/push-deploy.ps1 -BackupNeon VERIFICADO `
#     -FrontendUrl https://pneusistemma-frontend.vercel.app `
#     -CorsOrigin https://pneusistemma-frontend.vercel.app `
#     -ViteApiUrl https://pneusistemma-backend.onrender.com/api
#
# Simulação (não clona, não envia, não chama produção):
#   powershell -File scripts/push-deploy.ps1 -Simular -BackupNeon VERIFICADO `
#     -FrontendUrl https://pneusistemma-frontend.vercel.app `
#     -CorsOrigin https://pneusistemma-frontend.vercel.app `
#     -ViteApiUrl https://pneusistemma-backend.onrender.com/api
#
# Rollback, se uma publicação real precisar voltar:
# - Render: no serviço, rollback para o commit de backend em scripts/deploy-baselines.json.
# - Vercel: em Deployments, promova de novo o commit de frontend dessa mesma baseline.
# - Banco: restaure o dump verificado num branch novo do Neon, troque DATABASE_URL no Render e reinicie.
#   Não apague o branch antigo. Voltar o código não desfaz mudança já gravada no boot.

param(
  [string]$Message = "Atualiza deploy Vercel/Render a partir do monorepo.",
  [switch]$Simular,
  [string]$BackupNeon = "",
  [string]$FrontendUrl = "",
  [string]$CorsOrigin = "",
  [string]$ViteApiUrl = "",
  [string]$SimularFalha = "",
  [switch]$SomenteFuncoes
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$AuthorName = "alekal02"
$AuthorEmail = "alekal02@users.noreply.github.com"
$ExpectedFrontendUrl = "https://pneusistemma-frontend.vercel.app"
$ExpectedViteApiUrl = "https://pneusistemma-backend.onrender.com/api"
$HealthUrl = "https://pneusistemma-backend.onrender.com/api/health"
$BaselinePath = Join-Path $PSScriptRoot "deploy-baselines.json"

function Assert-DeployPreflight {
  param(
    [string]$BackupNeon,
    [string]$FrontendUrl,
    [string]$CorsOrigin,
    [string]$ViteApiUrl
  )

  if ($BackupNeon -ne "VERIFICADO") {
    throw "Publicacao bloqueada. Confirme o backup do Neon com -BackupNeon VERIFICADO (dump conferido; veiculos, pneus, medicoes e movimentacoes presentes)."
  }

  $front = $FrontendUrl.Trim().TrimEnd("/")
  $cors = $CorsOrigin.Trim()
  $api = $ViteApiUrl.Trim().TrimEnd("/")

  if ($front -ne $ExpectedFrontendUrl) {
    throw "Publicacao bloqueada. FRONTEND_URL precisa ser $ExpectedFrontendUrl (sem barra no final e sem localhost)."
  }
  if ($front -match "localhost|127\.0\.0\.1") {
    throw "Publicacao bloqueada. FRONTEND_URL nao pode apontar para localhost."
  }

  $origins = @($cors -split "," | ForEach-Object { $_.Trim().TrimEnd("/") } | Where-Object { $_ })
  if ($origins -notcontains $ExpectedFrontendUrl) {
    throw "Publicacao bloqueada. CORS_ORIGIN precisa incluir $ExpectedFrontendUrl."
  }

  if ($api -ne $ExpectedViteApiUrl) {
    throw "Publicacao bloqueada. VITE_API_URL precisa ser $ExpectedViteApiUrl."
  }
}

function Get-DeployBaselines {
  if (-not (Test-Path $BaselinePath)) {
    throw "Baseline ausente em scripts/deploy-baselines.json. Publicacao interrompida."
  }
  $json = Get-Content $BaselinePath -Raw | ConvertFrom-Json
  if (-not $json.backend -or -not $json.frontend) {
    throw "Baseline incompleta. Publicacao interrompida."
  }
  return $json
}

function Get-RollbackText {
  param($Baselines)
  @"
Rollback:
- Render: no servico, volte o deploy para $($Baselines.backend).
- Vercel: em Deployments, promova de novo $($Baselines.frontend).
- Banco: restaure o dump verificado num branch novo do Neon, troque DATABASE_URL no Render e reinicie. Nao apague o branch antigo.
"@
}

function Assert-NoExclusiveCommits {
  param(
    [string]$RepoDir,
    [string]$Baseline,
    [string]$Name
  )

  if (-not $Baseline) {
    throw "Baseline ausente para $Name. Publicacao interrompida."
  }

  $head = (git -C $RepoDir rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $head) {
    throw "Nao foi possivel ler o HEAD de $Name. Publicacao interrompida."
  }
  if ($head -eq $Baseline) {
    return
  }

  $log = ""
  git -C $RepoDir cat-file -e "$Baseline^{commit}" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $log = (git -C $RepoDir log --oneline "$Baseline..HEAD" | Out-String).Trim()
  } else {
    $log = "HEAD $head nao contem a baseline $Baseline."
  }

  throw "Commits exclusivos em ${Name}. Nada foi sobrescrito e o frontend nao sera publicado.`n$log"
}

function Protect-RemoteOnlyFiles {
  param(
    [string]$Src,
    [string]$RepoDir
  )

  $tracked = @(git -C $RepoDir ls-tree -r --name-only HEAD)
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel listar os arquivos de $RepoDir."
  }

  $kept = @()
  foreach ($rel in $tracked) {
    if (-not $rel) { continue }
    $srcFile = Join-Path $Src ($rel -replace "/", "\")
    if (Test-Path -LiteralPath $srcFile) { continue }
    git -C $RepoDir checkout HEAD -- $rel | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel preservar o arquivo exclusivo $rel."
    }
    $kept += $rel
  }
  return $kept
}

function Wait-BackendHealth {
  param(
    [string]$Url,
    [string]$ExpectedSha,
    [int]$MaxAttempts = 40,
    [scriptblock]$Fetch,
    [scriptblock]$Sleep = { param($Seconds) Start-Sleep -Seconds $Seconds }
  )

  if (-not $ExpectedSha) {
    throw "Health check do backend falhou (commit novo ausente). Frontend cancelado."
  }

  $expected = $ExpectedSha.Trim().ToLower()
  $last = "sem resposta"
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      $json = & $Fetch $Url
      $commit = ([string]$json.commit).Trim().ToLower()
      if ($json.status -eq "ok" -and $json.database -eq "postgresql" -and $commit -eq $expected) {
        return
      }
      $last = "status=$($json.status) commit=$commit"
    } catch {
      $last = $_.Exception.Message
    }
    if ($i -lt $MaxAttempts) {
      & $Sleep 15
    }
  }

  throw "Health check do backend falhou ($last). Frontend cancelado."
}

function Invoke-WebHealth {
  param([string]$Url)
  $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
  return ($resp.Content | ConvertFrom-Json)
}

function Invoke-DeploySequence {
  param(
    [scriptblock]$PublishBackend,
    [scriptblock]$CheckHealth,
    [scriptblock]$PublishFrontend
  )

  & $PublishBackend
  & $CheckHealth
  & $PublishFrontend
}

function Save-DeployBaseline {
  param(
    [string]$Name,
    [string]$Sha
  )

  $json = Get-Content $BaselinePath -Raw | ConvertFrom-Json
  $json.$Name = $Sha
  $json | ConvertTo-Json | Set-Content -Path $BaselinePath -Encoding utf8
}

function Stage-DeployCopy {
  param(
    [string]$Src,
    [string]$RepoDir,
    [string[]]$ExcludeDirs
  )

  $xd = @(".git", "node_modules", "dist") + $ExcludeDirs
  $robocopyArgs = @(
    $Src, $RepoDir, "/E",
    "/XF", ".env", "e2e-frota-chatbot.mjs", "limpar-dados-e2e.mjs", "seed-bh-teste.mjs",
    "importar-planilha-aparecida.mjs", "reimportar-planilha-bh.mjs",
    "montar-payload-planilha-aparecida.py", "montar-payload-planilha-bh.py",
    "/NFL", "/NDL", "/NJH", "/NJS"
  )
  foreach ($d in $xd) { $robocopyArgs += @("/XD", $d) }
  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar arquivos de $Src" }

  git -C $RepoDir add -A | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao preparar o commit em $RepoDir" }

  $kept = @(Protect-RemoteOnlyFiles -Src $Src -RepoDir $RepoDir)
  if ($kept.Count -gt 0) {
    Write-Host (">> Arquivos so do repositorio de deploy preservados: " + ($kept -join ", "))
  }
}

function Publish-SplitRepo {
  param(
    [string]$Name,
    [string]$Src,
    [string]$RepoUrl,
    [string]$Baseline,
    [string[]]$ExcludeDirs
  )

  $tmp = Join-Path $env:TEMP "pneusistemma-$Name-deploy"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }

  Write-Host ">> Clonando $Name..."
  git clone --depth 1 $RepoUrl $tmp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar $RepoUrl. Frontend cancelado." }

  Assert-NoExclusiveCommits -RepoDir $tmp -Baseline $Baseline -Name $Name

  Stage-DeployCopy -Src $Src -RepoDir $tmp -ExcludeDirs $ExcludeDirs

  git -C $tmp diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host ">> $Name`: sem alteracoes de conteudo."
    return ""
  }

  git -C $tmp -c user.name=$AuthorName -c user.email=$AuthorEmail commit -m $Message | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha no commit de $Name. Frontend cancelado." }

  $sha = (git -C $tmp rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sha) { throw "Falha ao ler o commit de $Name. Frontend cancelado." }

  git -C $tmp push origin HEAD | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha no push de $Name. Frontend cancelado." }

  Save-DeployBaseline -Name $Name -Sha $sha
  Write-Host ">> $Name enviado para $RepoUrl ($sha)"
  return $sha
}

function Invoke-PushDeploy {
  Assert-DeployPreflight -BackupNeon $BackupNeon -FrontendUrl $FrontendUrl -CorsOrigin $CorsOrigin -ViteApiUrl $ViteApiUrl

  $baselines = Get-DeployBaselines
  Write-Host (Get-RollbackText -Baselines $baselines)

  if ($SimularFalha -and -not $Simular) {
    throw "SimularFalha so pode ser usado junto com -Simular."
  }

  if ($Simular) {
    Write-Host "SIMULACAO: nenhum clone, push, health real ou alteracao de producao."
    switch ($SimularFalha) {
      "exclusivo" { throw "Commits exclusivos no backend. Nada foi sobrescrito e o frontend nao sera publicado." }
      "push" { throw "Falha no push do backend. Frontend cancelado." }
      "health" { throw "Health check do backend falhou (simulado). Frontend cancelado." }
      "" { }
      default { throw "SimularFalha invalida: $SimularFalha" }
    }

    Write-Host "1. Publicaria o backend no Render."
    Write-Host "2. Esperaria GET $HealthUrl com o commit novo e database=postgresql."
    Write-Host "3. So entao publicaria o frontend na Vercel."
    Write-Host "SIMULACAO concluida. Nenhum arquivo foi enviado."
    return
  }

  $backendSha = ""
  Invoke-DeploySequence -PublishBackend {
    $script:backendSha = Publish-SplitRepo -Name "backend" -Src (Join-Path $Root "backend") `
      -RepoUrl "https://github.com/alekal02/pneusistemma-backend.git" `
      -Baseline $baselines.backend -ExcludeDirs @("data", "logs")
  } -CheckHealth {
    $expected = $script:backendSha
    if (-not $expected) {
      throw "Health check do backend falhou (push sem commit novo). Frontend cancelado."
    }
    Wait-BackendHealth -Url $HealthUrl -ExpectedSha $expected -Fetch ${function:Invoke-WebHealth}
  } -PublishFrontend {
    Publish-SplitRepo -Name "frontend" -Src (Join-Path $Root "frontend") `
      -RepoUrl "https://github.com/alekal02/pneusistemma-frontend.git" `
      -Baseline $baselines.frontend -ExcludeDirs @() | Out-Null
  }

  Write-Host "Pronto. Backend publicado antes do frontend."
  Write-Host (Get-RollbackText -Baselines (Get-DeployBaselines))
}

if ($SomenteFuncoes -and $MyInvocation.InvocationName -eq ".") {
  return
}
if ($SomenteFuncoes) {
  throw "SomenteFuncoes so pode ser usado pelos testes."
}

try {
  Invoke-PushDeploy
  exit 0
} catch {
  Write-Host $_.Exception.Message
  exit 1
}
