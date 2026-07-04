using System.Diagnostics.Eventing.Reader;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services;

// This service is now responsible only for watching windows event logs.
// The responsibility of sending the data is delegated to ISqlCommandSender.
public sealed class WindowsErrorWatcherService(
    ILogger<WindowsErrorWatcherService> logger,
    IConfiguration configuration,
    ISqlCommandSender sqlCommandSender) : BackgroundService
{
    private readonly string _tableName = configuration.GetValue<string>("TableName") ?? "WindowsErrors";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Windows Error Watcher Service is starting.");

        var logNames = configuration.GetSection("LogNames").Get<string[]>() ?? [];
        if (logNames.Length == 0)
        {
            logger.LogWarning("No logs to watch. Check 'LogNames' in appsettings.json.");
            return;
        }

        var watchers = new List<EventLogWatcher>();
        
        foreach (var logName in logNames)
        {
            try
            {
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
                
                watchers.Add(watcher);
                watcher.Enabled = true;
                logger.LogInformation("Watching for errors and critical events in log: {LogName}", logName);
            }
            catch (EventLogNotFoundException)
            {
                logger.LogError("Event log '{LogName}' was not found. Please ensure it is a valid log name.", logName);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to start watching log '{LogName}'.", logName);
            }
        }
        
        await using (stoppingToken.Register(() =>
        {
            foreach (var watcher in watchers)
            {
                watcher.Enabled = false;
                watcher.Dispose();
            }
            logger.LogInformation("Windows Error Watcher Service is stopping.");
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
            
            await sqlCommandSender.Send(sqlQuery, cancellationToken);
            logger.LogInformation("Successfully processed event {EventID} from {LogName}.", eventRecord.Id, eventRecord.LogName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error processing event {EventID} from {LogName}.", eventRecord.Id, eventRecord.LogName);
        }
    }
}
