# Руководство по развертыванию на Ubuntu 24.04

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
Затем выполните SQL-скрипт `init.sql`.

### 3. Публикация и запуск приложения

```bash
# Склонируйте репозиторий или скопируйте файлы
# Перейдите в папку проекта

# Публикация приложения
dotnet publish -c Release -o /var/www/server_listener

# Скопируйте appsettings.json в папку публикации
cp appsettings.json /var/www/server_listener/appsettings.json
```

### 4. Создание systemd сервиса

Создайте файл `/etc/systemd/system/server-listener.service`:

```ini
[Unit]
Description=Server Listener Service

[Service]
WorkingDirectory=/var/www/server_listener
ExecStart=/usr/bin/dotnet /var/www/server_listener/server_listener.dll
Restart=always
RestartSec=10
SyslogIdentifier=server-listener
User=www-data
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=DOTNET_PRINT_TELEMETRY_MESSAGE=false

[Install]
WantedBy=multi-user.target
```

### 5. Управление сервисом

```bash
# Перезагрузка демона systemd
sudo systemctl daemon-reload

# Запуск сервиса
sudo systemctl start server-listener.service

# Включение автозапуска при загрузке системы
sudo systemctl enable server-listener.service

# Просмотр логов сервиса
sudo journalctl -fu server-listener.service
```
