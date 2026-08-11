param(
    [Parameter(Mandatory = $true)]
    [string]$XpiPath,

    [Parameter(Mandatory = $true)]
    [string]$ZoteroPath,

    [string]$AddonId = "referenceforzotero@woif-sha.github.io",

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

$resolvedXpiPath = (Resolve-Path -LiteralPath $XpiPath).Path
$resolvedZoteroPath = (Resolve-Path -LiteralPath $ZoteroPath).Path
$profilePath = Join-Path ([System.IO.Path]::GetTempPath()) ("reference-for-zotero-install-" + [guid]::NewGuid().ToString("N"))
$extensionsPath = Join-Path $profilePath "extensions"
$extensionsJsonPath = Join-Path $profilePath "extensions.json"
$stdoutPath = Join-Path $profilePath "zotero-stdout.log"
$stderrPath = Join-Path $profilePath "zotero-stderr.log"
$process = $null
$rootProcessId = $null

function Get-ProcessTreeIds {
    param([int]$RootId)

    $processes = @(Get-CimInstance Win32_Process)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootId)

    do {
        $added = $false
        foreach ($candidate in $processes) {
            if ($ids.Contains([int]$candidate.ParentProcessId) -and $ids.Add([int]$candidate.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)

    return @($ids)
}

try {
    [System.IO.Directory]::CreateDirectory($extensionsPath) | Out-Null
    Copy-Item -LiteralPath $resolvedXpiPath -Destination (Join-Path $extensionsPath "$AddonId.xpi")

    $startProcessParameters = @{
        FilePath               = $resolvedZoteroPath
        ArgumentList           = @("--headless", "--new-instance", "--profile", $profilePath)
        RedirectStandardOutput = $stdoutPath
        RedirectStandardError  = $stderrPath
        WindowStyle            = "Hidden"
        PassThru               = $true
    }
    $process = Start-Process @startProcessParameters
    $rootProcessId = $process.Id

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $extensionsJsonPath) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }

    if (-not (Test-Path -LiteralPath $extensionsJsonPath)) {
        throw "Timed out waiting for Zotero to scan the XPI."
    }

    Start-Sleep -Milliseconds 750
    $extensions = Get-Content -LiteralPath $extensionsJsonPath -Raw | ConvertFrom-Json
    $addon = $extensions.addons | Where-Object { $_.id -eq $AddonId } | Select-Object -First 1

    if ($null -eq $addon) {
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
        throw "Zotero rejected the XPI before registering addon '$AddonId'.`n$stderr"
    }

    if ($addon.appDisabled) {
        throw "Zotero registered addon '$AddonId' but marked it incompatible (appDisabled=$($addon.appDisabled))."
    }

    Write-Output "PASS: Zotero accepted $AddonId version $($addon.version) (userDisabled=$($addon.userDisabled) for profile side-loading)."
}
finally {
    if ($null -ne $rootProcessId) {
        $processTreeIds = Get-ProcessTreeIds -RootId $rootProcessId
        Get-Process -Id $processTreeIds -ErrorAction SilentlyContinue | Stop-Process -Force

        $processDeadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $remainingProcesses = @(Get-Process -Id $processTreeIds -ErrorAction SilentlyContinue)
            if ($remainingProcesses.Count -eq 0) {
                break
            }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $processDeadline)
    }

    if (Test-Path -LiteralPath $profilePath) {
        [System.IO.Directory]::Delete($profilePath, $true)
    }
}
