using System.Diagnostics.Eventing.Reader;
using System.Xml.Linq;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services.Security;

public class SecurityAuditorService : BackgroundService
{
    private readonly ILogger<SecurityAuditorService> _logger;
    private readonly ISqlCommandSender _sqlSender;
    private readonly string _machineName = Environment.MachineName;
    private readonly int _failedLogonEventId;

    public SecurityAuditorService(
        ILogger<SecurityAuditorService> logger,
        IConfiguration configuration,
        ISqlCommandSender sqlSender)
    {
        _logger = logger;
        _sqlSender = sqlSender;
        _failedLogonEventId = configuration.GetValue<int>("SecurityAuditor:FailedLogonEventId", 4625);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Security Auditor Service is starting.");

        var query = $"*[System/EventID={_failedLogonEventId}]";
        var eventLogQuery = new EventLogQuery("Security", PathType.LogName, query);
        using var watcher = new EventLogWatcher(eventLogQuery);

        watcher.EventRecordWritten += async (sender, args) =>
        {
            if (args.EventRecord != null)
            {
                await ProcessFailedLogonEvent(args.EventRecord, stoppingToken);
            }
        };

        watcher.Enabled = true;
        _logger.LogInformation("Watching for failed logon events (ID {EventID}) in the Security log.", _failedLogonEventId);

        await using (stoppingToken.Register(() =>
        {
            watcher.Enabled = false;
            _logger.LogInformation("Security Auditor Service is stopping.");
        }))
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
    }

    private async Task ProcessFailedLogonEvent(EventRecord eventRecord, CancellationToken cancellationToken)
    {
        try
        {
            // Event data is in XML format. We need to parse it to get details.
            var eventXml = XDocument.Parse(eventRecord.ToXml());
            XNamespace ns = "http://schemas.microsoft.com/win/2004/08/events/event";

            // Find the 'TargetUserName' data field in the event XML
            var targetUser = eventXml.Descendants(ns + "Data")
                                     .FirstOrDefault(d => d.Attribute("Name")?.Value == "TargetUserName")?.Value ?? "N/A";
            
            _logger.LogWarning("Failed logon detected for user: {User}", targetUser);

            var message = $"Failed logon attempt for user account: '{targetUser}'";
            var sql = FormatSql(message, "Failed Logon", eventRecord);
            
            await _sqlSender.Send(sql, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing failed logon event.");
        }
    }

    private string FormatSql(string message, string alertType, EventRecord eventRecord)
    {
        var sanitizedMessage = message.Replace("'", "''");
        return $$$"""
            INSERT INTO SystemLogs (EventType, EventID, MachineName, Source, LevelDisplayName, LogName, TimeCreated, Message)
            VALUES (
                'Security',
                {{{eventRecord.Id}}},
                '{{{_machineName}}}',
                '{{{alertType}}}',
                'N/A',
                'Security',
                '{{{eventRecord.TimeCreated?.ToString("yyyy-MM-dd HH:mm:ss")}}}',
                '{{{sanitizedMessage}}}'
            );
            """;
    }
}
