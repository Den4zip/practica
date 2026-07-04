using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services.Metrics;

public class SystemMetricsService : BackgroundService
{
    private readonly ILogger<SystemMetricsService> _logger;
    private readonly ISqlCommandSender _sqlSender;
    private readonly TimeSpan _pollingInterval;
    private readonly double _diskSpaceThreshold;
    private readonly string _metricsTableName;
    private readonly string _machineName = Environment.MachineName;

    private readonly PerformanceCounter _cpuCounter;
    private readonly PerformanceCounter _ramCounter;

    public SystemMetricsService(
        ILogger<SystemMetricsService> logger,
        IConfiguration configuration,
        ISqlCommandSender sqlSender)
    {
        _logger = logger;
        _sqlSender = sqlSender;

        _pollingInterval = TimeSpan.FromMinutes(configuration.GetValue<int>("SystemMetrics:PollingIntervalMinutes", 5));
        _diskSpaceThreshold = configuration.GetValue<double>("SystemMetrics:DiskSpaceThresholdPercent", 10);
        _metricsTableName = configuration.GetValue<string>("SystemMetrics:MetricsTableName") ?? "SystemMetrics";

        _cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
        _ramCounter = new PerformanceCounter("Memory", "Available MBytes");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // ... (rest of the file is unchanged)


        // Initial wait to get a reading from CPU counter
        await Task.Delay(1000, stoppingToken); 

        using var timer = new PeriodicTimer(_pollingInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            CheckDiskSpace(stoppingToken);
            await CollectSystemMetrics(stoppingToken);

            await timer.WaitForNextTickAsync(stoppingToken);
        }
    }

    private void CheckDiskSpace(CancellationToken cancellationToken)
    {
        try
        {
            var drive = new DriveInfo("C");
            var totalSize = drive.TotalSize;
            var freeSpace = drive.TotalFreeSpace;
            var freeSpacePercent = (double)freeSpace / totalSize * 100;

            _logger.LogInformation("C: Drive: {FreeSpacePercent:F2}% free.", freeSpacePercent);

            if (freeSpacePercent < _diskSpaceThreshold)
            {
                _logger.LogWarning("Low disk space detected! {FreeSpacePercent:F2}% free.", freeSpacePercent);
                var message = $"Critical: Low disk space on drive C:. Only {freeSpacePercent:F2}% free space remaining.";
                var sql = FormatSql("Low Disk Space", message, "Critical");
                _sqlSender.Send(sql, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check disk space.");
        }
    }

    private async Task CollectSystemMetrics(CancellationToken cancellationToken)
    {
        try
        {
            var cpuUsage = _cpuCounter.NextValue();
            var freeRam = _ramCounter.NextValue();

            _logger.LogInformation("Current CPU Usage: {CpuUsage:F2}%, Free RAM: {FreeRam}MB", cpuUsage, freeRam);

            var message = $"CPU Usage: {cpuUsage:F2}%, Free RAM: {freeRam}MB";
            var sql = FormatSql("System Metrics Update", message, "Information");
            await _sqlSender.Send(sql, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to collect system metrics (CPU/RAM).");
        }
    }

    private string FormatSql(string metricType, string message, string level)
    {
        var sanitizedMessage = message.Replace("'", "''");
        return $$$"""
            INSERT INTO {{{_metricsTableName}}} (MachineName, MetricType, Message, Level, TimeCreated)
            VALUES (
                '{{{_machineName}}}',
                '{{{metricType}}}',
                '{{{sanitizedMessage}}}',
                '{{{level}}}',
                '{{{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}}}'
            );
            """;
    }
}
