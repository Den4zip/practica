$ErrorActionPreference = "Stop"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Установка Windows Error Catcher Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
""

# ---- 1. EXE ----
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exeCandidates = @(
    Join-Path $scriptDir "error_catcher.exe"
    Join-Path $scriptDir "publish\error_catcher.exe"
)
$exePath = $null
foreach ($candidate in $exeCandidates) {
    if (Test-Path $candidate) { $exePath = $candidate; break }
}
if (-not $exePath) {
    Write-Host "Не найден error_catcher.exe в текущей папке." -ForegroundColor Red
    Write-Host "Поместите install.ps1 и error_catcher.exe в одну папку." -ForegroundColor Yellow
    pause; exit 1
}
Write-Host "✔ Найден: $exePath" -ForegroundColor Green
""

# ---- 2. IP сервера ----
do {
    $ServerIp = Read-Host "Введите IP-адрес сервера BEACON (на котором запущен server_listener)"
    if ([string]::IsNullOrWhiteSpace($ServerIp)) {
        Write-Host "IP не может быть пустым." -ForegroundColor Red; continue
    }
    # Проверка формата IPv4
    $ipRegex = '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$'
    if ($ServerIp -notmatch $ipRegex) {
        Write-Host "Неверный формат IP. Введите IPv4 (например, 192.168.1.100)." -ForegroundColor Red
        $ServerIp = $null
    }
} while (-not $ServerIp)

$Port = Read-Host "Порт сервера [8080]"
if ([string]::IsNullOrWhiteSpace($Port)) { $Port = 8080 }
$ServerUrl = "http://${ServerIp}:${Port}/query"
Write-Host "  ServerUrl: $ServerUrl" -ForegroundColor Gray
""

# ---- 3. Название службы ----
$ServiceName = Read-Host "Имя службы Windows [ErrorCatcher]"
if ([string]::IsNullOrWhiteSpace($ServiceName)) { $ServiceName = "ErrorCatcher" }
""

# ---- 4. Путь установки ----
$defaultDir = "$env:ProgramFiles\$ServiceName"
$InstallDir = Read-Host "Папка установки [$defaultDir]"
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = $defaultDir }
""

# ---- 5. ApiKey ----
$ApiKey = Read-Host "API-ключ для доступа к серверу [SuperSecretKey123]"
if ([string]::IsNullOrWhiteSpace($ApiKey)) { $ApiKey = "SuperSecretKey123" }
""

# ---- 6. Журналы для отслеживания ----
$LogNamesInput = Read-Host "Какие журналы Windows отслеживать? (через запятую) [Application,System]"
if ([string]::IsNullOrWhiteSpace($LogNamesInput)) { $LogNamesInput = "Application,System" }
$LogNames = $LogNamesInput -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

# ---- 7. Создание папки и копирование ----
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "✔ Создана папка: $InstallDir" -ForegroundColor Green
}
$TargetExe = Join-Path $InstallDir "error_catcher.exe"
Copy-Item -Path $exePath -Destination $TargetExe -Force
Write-Host "✔ Скопирован exe: $TargetExe" -ForegroundColor Green

# ---- 8. Создание appsettings.json ----
$logNamesJson = $LogNames | ForEach-Object { "    `"$_`"" }
$logNamesBlock = $logNamesJson -join ",`n"
$AppSettings = Join-Path $InstallDir "appsettings.json"
@"
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.Hosting.Lifetime": "Information"
    }
  },
  "ServerUrl": "$ServerUrl",
  "ApiToken": "$ApiKey",
  "TableName": "WindowsErrors",
  "LogNames": [
$logNamesBlock
  ],
  "ErrorCaching": {
    "CacheFilePath": "error_cache.json",
    "RetryIntervalMinutes": 1
  },
  "SystemMetrics": {
    "PollingIntervalMinutes": 5,
    "DiskSpaceThresholdPercent": 10,
    "MetricsTableName": "SystemMetrics"
  },
  "SecurityAuditor": {
    "FailedLogonEventId": 4625
  },
  "ServiceMonitor": {
    "PollingIntervalMinutes": 2,
    "ServicesToWatch": [
      "wuauserv"
    ]
  }
}
"@ | Set-Content -Path $AppSettings -Encoding UTF8
Write-Host "✔ Создан: $AppSettings" -ForegroundColor Green

# ---- 9. Создание пустого error_cache.json ----
$ErrorCache = Join-Path $InstallDir "error_cache.json"
'[]' | Set-Content -Path $ErrorCache -Encoding UTF8
Write-Host "✔ Создан: $ErrorCache" -ForegroundColor Green

""
Write-Host "═══ Установка службы ═══" -ForegroundColor Cyan

# ---- 10. Удаляем старую службу если есть ----
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Служба '$ServiceName' уже существует. Останавливаю и удаляю..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# ---- 11. Регистрируем ----
New-Service -Name $ServiceName `
    -BinaryPathName $TargetExe `
    -DisplayName "Windows Error Catcher Service" `
    -Description "Сбор и отправка системных ошибок, предупреждений и метрик на сервер BEACON" `
    -StartupType Automatic | Out-Null
Write-Host "✔ Служба '$ServiceName' зарегистрирована" -ForegroundColor Green

# ---- 12. Запускаем ----
Start-Service -Name $ServiceName
Write-Host "✔ Служба '$ServiceName' запущена" -ForegroundColor Green

# ---- 13. Проверка ----
Start-Sleep -Seconds 3
$status = Get-Service -Name $ServiceName
""
if ($status.Status -eq 'Running') {
    Write-Host "✅ Установка завершена успешно!" -ForegroundColor Green
    Write-Host "  Служба:       $ServiceName" -ForegroundColor Gray
    Write-Host "  Папка:        $InstallDir" -ForegroundColor Gray
    Write-Host "  Сервер:       $ServerUrl" -ForegroundColor Gray
} else {
    Write-Host "⚠ Служба установлена, но не запустилась (статус: $($status.Status))." -ForegroundColor Red
    Write-Host "  Проверьте журнал событий Windows или Event Viewer." -ForegroundColor Gray
    Write-Host "  Запустите вручную: Start-Service -Name $ServiceName" -ForegroundColor Gray
}
""
pause
