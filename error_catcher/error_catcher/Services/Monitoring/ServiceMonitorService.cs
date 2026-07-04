using System.ServiceProcess;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services.Monitoring;

public class ServiceMonitorService : BackgroundService
{
    private readonly ILogger<ServiceMonitorService> _logger;
    private readonly ISqlCommandSender _sqlSender;
    private readonly string[] _servicesToWatch;
    private readonly TimeSpan _pollingInterval;
    private readonly string _machineName = Environment.MachineName;
    private readonly Dictionary<string, ServiceControllerStatus> _serviceStatus;

    public ServiceMonitorService(
        ILogger<ServiceMonitorService> logger,
        IConfiguration configuration,
        ISqlCommandSender sqlSender)
    {
        _logger = logger;
        _sqlSender = sqlSender;
        _servicesToWatch = configuration.GetSection("ServiceMonitor:ServicesToWatch").Get<string[]>() ?? [];
        _pollingInterval = TimeSpan.FromMinutes(configuration.GetValue<int>("ServiceMonitor:PollingIntervalMinutes", 2));
        _serviceStatus = new Dictionary<string, ServiceControllerStatus>();
        
        _logger.LogInformation("Loaded {Count} services to watch from configuration.", _servicesToWatch.Length);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_servicesToWatch.Length == 0)
        {
            _logger.LogWarning("No services to monitor. Check 'ServiceMonitor:ServicesToWatch' in appsettings.json.");
            return;
        }
        
        _logger.LogInformation("Service Monitor is starting. Watching {ServiceCount} services.", _servicesToWatch.Length);
        InitializeServiceStatus(stoppingToken);
        
        using var timer = new PeriodicTimer(_pollingInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            CheckServiceStatuses(stoppingToken);
            await timer.WaitForNextTickAsync(stoppingToken);
        }
        _logger.LogInformation("Service Monitor is stopping.");
    }
    
    private void InitializeServiceStatus(CancellationToken cancellationToken)
    {
        foreach (var serviceName in _servicesToWatch)
        {
             if (cancellationToken.IsCancellationRequested) return;
             try
             {
                 using var sc = new ServiceController(serviceName);
                 _serviceStatus[serviceName] = sc.Status;
                 _logger.LogInformation("Initial status for service '{ServiceName}': {Status}", serviceName, sc.Status);
             }
             catch (Exception ex)
             {
                 _logger.LogError(ex, "Failed to get initial status for service '{ServiceName}'. It may not exist.", serviceName);
                 _serviceStatus[serviceName] = ServiceControllerStatus.Stopped; // Assume stopped if inaccessible
             }
        }
    }
    
    private void CheckServiceStatuses(CancellationToken cancellationToken)
    {
        foreach (var serviceName in _servicesToWatch)
        {
            if (cancellationToken.IsCancellationRequested) return;

            try
            {
                using var sc = new ServiceController(serviceName);
                var currentStatus = sc.Status;
                var lastStatus = _serviceStatus[serviceName];

                if (currentStatus != lastStatus)
                {
                    _logger.LogInformation("Status change for service '{ServiceName}': {LastStatus} -> {CurrentStatus}", serviceName, lastStatus, currentStatus);
                    _serviceStatus[serviceName] = currentStatus;

                    if (currentStatus == ServiceControllerStatus.Stopped)
                    {
                        _logger.LogWarning("Service '{ServiceName}' has stopped!", serviceName);
                        var message = $"Critical: Monitored service '{serviceName}' has stopped.";
                        var sql = FormatSql(serviceName, message);
                        _sqlSender.Send(sql, cancellationToken);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to check status for service '{ServiceName}'.", serviceName);
                 // If it was running and now we can't access it, assume it stopped.
                if (_serviceStatus.TryGetValue(serviceName, out var lastStatus) && lastStatus != ServiceControllerStatus.Stopped)
                {
                    var message = $"Critical: Failed to access service '{serviceName}'. It may have been uninstalled or is in an error state.";
                    var sql = FormatSql(serviceName, message);
                     _sqlSender.Send(sql, cancellationToken);
                }
                 _serviceStatus[serviceName] = ServiceControllerStatus.Stopped;
            }
        }
    }

    private string FormatSql(string serviceName, string message)
    {
        var sanitizedMessage = message.Replace("'", "''");
        return $$$"""
            INSERT INTO SystemLogs (MachineName, EventType, Source, Message, TimeCreated)
            VALUES (
                '{{{_machineName}}}',
                'Service',
                '{{{serviceName}}}',
                '{{{sanitizedMessage}}}',
                '{{{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}}}'
            );
            """;
    }
}
