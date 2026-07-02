using System.Diagnostics.Eventing.Reader;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;

// Используем упрощенные пространства имен на уровне файла
namespace ErrorCatcher.Services;

public static class Program
{
    public static void Main(string[] args)
    {
        // Настройка и запуск хоста приложения
        CreateHostBuilder(args).Build().Run();
    }

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            // Указываем, что это будет служба Windows
            .UseWindowsService(options =>
            {
                options.ServiceName = "Windows Error Catcher Service";
            })
            .ConfigureServices((context, services) =>
            {
                // Добавляем HttpClient для отправки данных на сервер
                services.AddHttpClient<WindowsErrorWatcherService>();
                // Регистрируем нашу службу как фоновый сервис
                services.AddHostedService<WindowsErrorWatcherService>();
            });
}

// Фоновая служба для отслеживания ошибок Windows, использующая первичный конструктор
public sealed class WindowsErrorWatcherService(
    ILogger<WindowsErrorWatcherService> logger,
    IConfiguration configuration,
    HttpClient httpClient) : BackgroundService
{
    // Переменная для хранения имени таблицы из конфигурации
    private readonly string _tableName = configuration.GetValue<string>("TableName") ?? "WindowsErrors";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Служба отслеживания ошибок запущена.");

        // Получаем список журналов для отслеживания из appsettings.json
        var logNames = configuration.GetSection("LogNames").Get<string[]>() ?? [];
        if (logNames.Length == 0)
        {
            logger.LogWarning("Список отслеживаемых журналов пуст. Проверьте 'LogNames' в appsettings.json.");
            return;
        }

        // Устанавливаем базовый адрес и таймаут для HttpClient
        var serverUrl = configuration.GetValue<string>("ServerUrl");
        if (string.IsNullOrEmpty(serverUrl))
        {
            logger.LogError("URL сервера не указан. Проверьте 'ServerUrl' в appsettings.json.");
            return;
        }
        httpClient.BaseAddress = new Uri(serverUrl);
        httpClient.Timeout = TimeSpan.FromSeconds(30);

        // Список для хранения наблюдателей и имен их журналов
        var watchers = new List<(EventLogWatcher Watcher, string LogName)>();
        
        // Настраиваем наблюдателей для каждого указанного журнала
        foreach (var logName in logNames)
        {
            // Запрос для фильтрации событий: только 'Критические' (1) и 'Ошибки' (2)
            var query = "*[System/Level=1 or System/Level=2]";
            var eventLogQuery = new EventLogQuery(logName, PathType.LogName, query);
            var watcher = new EventLogWatcher(eventLogQuery);

            watcher.EventRecordWritten += async (sender, args) =>
            {
                if (args.EventRecord != null)
                {
                    await ProcessEventLog(args.EventRecord, stoppingToken);
                }
            };
            
            watchers.Add((watcher, logName));
        }
        
        // Включаем всех наблюдателей
        foreach (var (watcher, logName) in watchers)
        {
            watcher.Enabled = true;
            logger.LogInformation("Отслеживание событий для журнала '{LogName}' включено.", logName);
        }

        // Ожидаем сигнала отмены для завершения работы службы
        await using (stoppingToken.Register(() =>
        {
            // Отключаем и освобождаем ресурсы при остановке
            foreach (var (watcher, logName) in watchers)
            {
                watcher.Enabled = false;
                watcher.Dispose();
                logger.LogInformation("Отслеживание событий для журнала '{LogName}' остановлено.", logName);
            }
        }))
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        
        logger.LogInformation("Служба отслеживания ошибок остановлена.");
    }

    // Метод обработки события и отправки данных
    private async Task ProcessEventLog(EventRecord eventRecord, CancellationToken cancellationToken)
    {
        try
        {
            // Базовая очистка данных: заменяем одинарную кавычку на двойную
            var sanitizedMessage = (eventRecord.FormatDescription() ?? "No message").Replace("'", "''");

            // Формирование SQL-запроса с использованием сырых строковых литералов
            var sqlQuery = $$$"""
                INSERT INTO {{{_tableName}}} (EventID, MachineName, Source, LevelDisplayName, LogName, TimeCreated, Message)
                VALUES (
                    {{{eventRecord.Id}}},
                    '{{{eventRecord.MachineName}}}',
                    '{{{eventRecord.ProviderName}}}',
                    '{{{eventRecord.LevelDisplayName}}}',
                    '{{{eventRecord.LogName}}}',
                    '{{{eventRecord.TimeCreated?.ToString("yyyy-MM-dd HH:mm:ss")}}}',
                    '{{{sanitizedMessage}}}'
                );
                """;
            
            logger.LogInformation("Сформирован SQL-запрос для события {EventID}.", eventRecord.Id);

            // Отправка запроса на сервер
            var content = new StringContent(sqlQuery, Encoding.UTF8, "application/sql");
            var response = await httpClient.PostAsync("", content, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                logger.LogInformation("Данные по событию {EventID} успешно отправлены.", eventRecord.Id);
            }
            else
            {
                logger.LogError("Не удалось отправить данные по событию {EventID}. Статус-код: {StatusCode}", eventRecord.Id, response.StatusCode);
            }
        }
        catch (HttpRequestException ex)
        {
            // Обработка ошибок сети или недоступности сервера
            logger.LogError(ex, "Ошибка при отправке данных на сервер. Проверьте доступность сервера.");
        }
        catch (Exception ex)
        {
            // Обработка других непредвиденных ошибок
            logger.LogError(ex, "Произошла непредвиденная ошибка при обработке события {EventID}.", eventRecord.Id);
        }
    }
}
