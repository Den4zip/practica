# Руководство по развертыванию на Ubuntu 24.04

Это руководство описывает как первоначальную настройку, так и обновление существующего приложения.

---

### 1. Установка .NET 10

```bash
# Регистрация ключа Microsoft
sudo mkdir -p /etc/apt/keyrings
wget https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
rm packages-microsoft-prod.deb

# Установка SDK (включает runtime)
sudo apt-get update
sudo apt-get install -y dotnet-sdk-10.0 
```

### 2. Установка и настройка MariaDB

```bash
# Установка сервера
sudo apt-get install -y mariadb-server

# Запуск и проверка статуса
sudo systemctl start mariadb
sudo systemctl enable mariadb

# Первоначальная безопасная настройка
sudo mysql_secure_installation

# Вход в MariaDB и создание пользователя
sudo mariadb -u root -p

# Внутри MariaDB
CREATE DATABASE ErrorLogsDB;
CREATE USER 'your_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON ErrorLogsDB.* TO 'your_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
Затем выполните SQL-скрипт `init.sql` для создания таблицы `WindowsErrors`.

### 3. Публикация и запуск приложения

```bash
# На вашей локальной машине (или сборочном сервере)
# Перейдите в папку проекта

# Публикация приложения
dotnet publish -c Release

# После этого у вас появится папка bin/Release/net10.0/publish,
# содержимое которой нужно будет скопировать на сервер.
```

### 4. Размещение файлов на сервере

Скопируйте опубликованные файлы в целевую директорию на сервере.

```bash
# Создайте директорию, если она не существует
sudo mkdir -p /var/www/server_listener

# Скопируйте файлы (например, с помощью scp или rsync)
# Замените local_publish_path на путь к вашей папке publish
scp -r local_publish_path/* user@your_server_ip:/var/www/server_listener
```

### 5. Создание и настройка systemd сервиса

Создайте файл `/etc/systemd/system/server-listener.service`:

```ini
[Unit]
Description=Server Listener Service
After=network.target

[Service]
WorkingDirectory=/var/www/server_listener
ExecStart=/usr/bin/dotnet /var/www/server_listener/server_listener.dll
Restart=always
RestartSec=10
SyslogIdentifier=server-listener
User=www-data
Group=www-data
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=DOTNET_PRINT_TELEMETRY_MESSAGE=false

[Install]
WantedBy=multi-user.target
```

**Важно**: После создания или изменения файла сервиса выполните `sudo systemctl daemon-reload`.

### 6. Управление сервисом

```bash
# Запуск сервиса
sudo systemctl start server-listener

# Включение автозапуска при загрузке системы
sudo systemctl enable server-listener

# Просмотр статуса
sudo systemctl status server-listener

# Просмотр логов в реальном времени
sudo journalctl -fu server-listener
```

---

## Раздел 7: Обновление приложения до новой версии

Этот раздел описывает, как обновить работающее приложение до последней версии с минимальным временем простоя.

### Шаг 1: Публикация новой версии

На вашей локальной машине соберите новую версию приложения:

```bash
dotnet publish -c Release
```

### Шаг 2: Остановка службы на сервере

Подключитесь к вашему Ubuntu-серверу и остановите текущую службу, чтобы освободить файлы:

```bash
sudo systemctl stop server-listener
```

### Шаг 3: Обновление `appsettings.json`

**Это самый важный шаг.** Не заменяйте файл `appsettings.json` на сервере полностью, так как он содержит рабочие настройки подключения к базе данных. Вместо этого, откройте его и добавьте новые секции конфигурации.

Откройте файл для редактирования: `sudo nano /var/www/server_listener/appsettings.json`

Добавьте в него секции `"Security"` и `"RateLimiter"`, как показано ниже. Убедитесь, что вы не затронули существующую секцию `"ConnectionStrings"`.

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;Database=ErrorLogsDB;User=your_user;Password=your_password;"
  },
  "Kestrel": {
    "Endpoints": {
      "HttpApi": {
        "Url": "http://*:80"
      },
      "HttpIngest": {
        "Url": "http://*:8080"
      }
    }
  },
  "Security": {
    "ApiKey": "SuperSecretKey123"
  },
  "RateLimiter": {
    "PermitLimit": 100,
    "Window": 60
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```
**Примечание**: Замените `"SuperSecretKey123"` на ваш собственный сгенерированный ключ.

### Шаг 4: Копирование новых файлов

Скопируйте файлы из вашей папки `publish` на сервер, заменяя существующие. Использование `rsync` является предпочтительным, так как он эффективно копирует только измененные файлы.

```bash
# Замените local_publish_path на путь к папке bin/Release/net10.0/publish/
# --exclude 'appsettings.json' предотвратит перезапись вашей конфигурации
rsync -avz --exclude 'appsettings.json' local_publish_path/ user@your_server_ip:/var/www/server_listener/
```

### Шаг 5: Запуск обновленной службы

Теперь, когда файлы обновлены, запустите службу снова:

```bash
sudo systemctl start server-listener
```

### Шаг 6: Проверка работы

Убедитесь, что служба запустилась успешно и работает без ошибок:

```bash
sudo systemctl status server-listener
```

Если статус `active (running)`, проверьте логи на наличие каких-либо предупреждений или ошибок:

```bash
sudo journalctl -fu server-listener -n 50
```

На этом обновление завершено. Ваше приложение теперь работает на новой версии.
