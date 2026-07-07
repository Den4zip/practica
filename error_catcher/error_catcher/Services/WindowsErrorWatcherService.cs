using System.Diagnostics.Eventing.Reader;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services;

public sealed class WindowsErrorWatcherService : BackgroundService
{
    private readonly ILogger<WindowsErrorWatcherService> _logger;
    private readonly IConfiguration _configuration;
    private readonly ISqlCommandSender _sqlCommandSender;

    public WindowsErrorWatcherService(
        ILogger<WindowsErrorWatcherService> logger,
        IConfiguration configuration,
        ISqlCommandSender sqlCommandSender)
    {
        _logger = logger;
        _configuration = configuration;
        _sqlCommandSender = sqlCommandSender;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Windows Error Watcher Service is starting.");

        var logNames = _configuration.GetSection("LogNames").Get<string[]>() ?? [];
        if (logNames.Length == 0)
        {
            _logger.LogWarning("No logs to watch. Check 'LogNames' in appsettings.json.");
            return;
        }

        var watchers = new List<EventLogWatcher>();
        
        foreach (var logName in logNames)
        {
            try
            {
                var query = "*[System/Level=1 or System/Level=2 or System/Level=3]";
                var eventLogQuery = new EventLogQuery(logName, PathType.LogName, query);
                var watcher = new EventLogWatcher(eventLogQuery);

                watcher.EventRecordWritten += async (sender, args) =>
                {
                    if (args.EventRecord != null)
                    {
                        await ProcessEventLog(args.EventRecord, stoppingToken);
                    }
                };
                
                watchers.Add(watcher);
                watcher.Enabled = true;
                _logger.LogInformation("Watching for errors and critical events in log: {LogName}", logName);
            }
            catch (EventLogNotFoundException)
            {
                _logger.LogError("Event log '{LogName}' was not found. Please ensure it is a valid log name.", logName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start watching log '{LogName}'.", logName);
            }
        }
        
        await using (stoppingToken.Register(() =>
        {
            foreach (var watcher in watchers)
            {
                watcher.Enabled = false;
                watcher.Dispose();
            }
            _logger.LogInformation("Windows Error Watcher Service is stopping.");
        }))
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
    }

    private async Task ProcessEventLog(EventRecord eventRecord, CancellationToken cancellationToken)
    {
        try
        {
            var sanitizedMessage = (eventRecord.FormatDescription() ?? "No message").Replace("'", "''");

            var sqlQuery = $$$"""
                INSERT INTO SystemLogs (EventType, EventID, MachineName, Source, LevelDisplayName, LogName, TimeCreated, Message)
                VALUES (
                    'WindowsError',
                    {{{eventRecord.Id}}},
                    '{{{eventRecord.MachineName}}}',
                    '{{{eventRecord.ProviderName}}}',
                    '{{{eventRecord.LevelDisplayName}}}',
                    '{{{eventRecord.LogName}}}',
                    '{{{eventRecord.TimeCreated?.ToString("yyyy-MM-dd HH:mm:ss")}}}',
                    '{{{sanitizedMessage}}}'
                );
                """;
            
            await _sqlCommandSender.Send(sqlQuery, cancellationToken);
            _logger.LogInformation("Successfully processed event {EventID} from {LogName}.", eventRecord.Id, eventRecord.LogName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing event {EventID} from {LogName}.", eventRecord.Id, eventRecord.LogName);
        }
    }
}
