using ErrorCatcher.Services;
using ErrorCatcher.Services.Cache;
using ErrorCatcher.Services.Metrics;
using ErrorCatcher.Services.Monitoring;
using ErrorCatcher.Services.Security;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

public static class Program
{
    public static void Main(string[] args)
    {
        // Устанавливаем рабочую директорию в папку, где физически лежит исполняемый файл
        Directory.SetCurrentDirectory(AppContext.BaseDirectory);
        CreateHostBuilder(args).Build().Run();
    }

    public static IHostBuilder CreateHostBuilder(string[] args)
    {
        // Ensure the content root is set to the application's directory
        var pathToExe = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName 
                        ?? throw new InvalidOperationException("Could not determine executable path.");
        var pathToContentRoot = Path.GetDirectoryName(pathToExe) 
                                ?? throw new InvalidOperationException("Could not determine content root path.");

        return Host.CreateDefaultBuilder(args)
            .UseContentRoot(pathToContentRoot)
            .UseWindowsService(options =>
            {
                options.ServiceName = "ErrorCatcher";
            })
            .ConfigureServices((context, services) =>
            {
                // Add the IHttpClientFactory
                services.AddHttpClient();
                
                // Register the caching service. It's a singleton to hold the queue and a hosted service to process it.
                services.AddSingleton<IErrorCacheService, JsonErrorCacheService>();
                services.AddHostedService(sp => (JsonErrorCacheService)sp.GetRequiredService<IErrorCacheService>());

                // Register the centralized SQL command sender
                services.AddScoped<ISqlCommandSender, SqlCommandSender>();

                // Add an HttpClient for the primary sender
                services.AddHttpClient<ISqlCommandSender, SqlCommandSender>();
                
                // Register the main service for watching event logs
                services.AddHostedService<WindowsErrorWatcherService>();

                // Register the new System Metrics service
                services.AddHostedService<SystemMetricsService>();

                // Register the new Security Auditor service
                services.AddHostedService<SecurityAuditorService>();

                // Register the new Service Monitor service
                services.AddHostedService<ServiceMonitorService>();
            });
    }
}
