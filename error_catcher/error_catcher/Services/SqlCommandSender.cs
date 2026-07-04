using System.Text;
using ErrorCatcher.Services.Cache;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services;

public class SqlCommandSender : ISqlCommandSender
{
    private readonly ILogger<SqlCommandSender> _logger;
    private readonly HttpClient _httpClient;
    private readonly IErrorCacheService _cacheService;

    public SqlCommandSender(
        ILogger<SqlCommandSender> logger,
        IConfiguration configuration,
        HttpClient httpClient,
        IErrorCacheService cacheService)
    {
        _logger = logger;
        _httpClient = httpClient;
        _cacheService = cacheService;

        var serverUrl = configuration.GetValue<string>("ServerUrl");
        if (string.IsNullOrEmpty(serverUrl))
        {
            _logger.LogError("Server URL is not configured. Please check 'ServerUrl' in appsettings.json.");
            throw new InvalidOperationException("Server URL is not configured.");
        }
        
        var apiToken = configuration.GetValue<string>("ApiToken");
        if (string.IsNullOrEmpty(apiToken))
        {
            _logger.LogWarning("API Token is not configured. Requests may be unauthorized.");
        }

        _httpClient.BaseAddress = new Uri(serverUrl);
        _httpClient.Timeout = TimeSpan.FromSeconds(30);
        if (!string.IsNullOrEmpty(apiToken))
        {
            _httpClient.DefaultRequestHeaders.Add("X-Api-Key", apiToken);
        }
    }

    public async Task Send(string sqlCommand, CancellationToken cancellationToken)
    {
        try
        {
            var content = new StringContent(sqlCommand, Encoding.UTF8, "application/sql");
            var response = await _httpClient.PostAsync("", content, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("SQL command sent successfully.");
            }
            else
            {
                _logger.LogError("Failed to send SQL command. Status code: {StatusCode}. Caching command.", response.StatusCode);
                await _cacheService.CacheCommand(sqlCommand);
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Network error while sending SQL command. Caching command.");
            await _cacheService.CacheCommand(sqlCommand);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An unexpected error occurred while sending SQL command. Caching command.");
            await _cacheService.CacheCommand(sqlCommand);
        }
    }
}
