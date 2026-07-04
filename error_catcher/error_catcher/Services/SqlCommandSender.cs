using System.Text;
using ErrorCatcher.Services.Cache;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services;

// This service handles the direct HTTP sending of SQL commands.
// It now interacts with the caching service upon failure.
public class SqlCommandSender(
    ILogger<SqlCommandSender> logger,
    IConfiguration configuration,
    HttpClient httpClient,
    IErrorCacheService cacheService) : ISqlCommandSender
{
    private readonly ILogger<SqlCommandSender> _logger = logger;

    init
    {
        var serverUrl = configuration.GetValue<string>("ServerUrl");
        if (string.IsNullOrEmpty(serverUrl))
        {
            _logger.LogError("Server URL is not configured. Please check 'ServerUrl' in appsettings.json.");
            throw new InvalidOperationException("Server URL is not configured.");
        }
        httpClient.BaseAddress = new Uri(serverUrl);
        httpClient.Timeout = TimeSpan.FromSeconds(30);
    }

    public async Task Send(string sqlCommand, CancellationToken cancellationToken)
    {
        try
        {
            var content = new StringContent(sqlCommand, Encoding.UTF8, "application/sql");
            var response = await httpClient.PostAsync("", content, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("SQL command sent successfully.");
            }
            else
            {
                _logger.LogError("Failed to send SQL command. Status code: {StatusCode}. Caching command.", response.StatusCode);
                await cacheService.CacheCommand(sqlCommand);
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Network error while sending SQL command. Caching command.");
            await cacheService.CacheCommand(sqlCommand);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An unexpected error occurred while sending SQL command. Caching command.");
            await cacheService.CacheCommand(sqlCommand);
        }
    }
}
