using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ErrorCatcher.Services.Cache;

public class JsonErrorCacheService : BackgroundService, IErrorCacheService
{
    private readonly ILogger<JsonErrorCacheService> _logger;
    private readonly string _cacheFilePath;
    private readonly TimeSpan _retryInterval;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _serverUrl;
    
    private static readonly ConcurrentQueue<string> CommandQueue = new();
    private static readonly SemaphoreSlim FileLock = new(1, 1);

    public JsonErrorCacheService(
        ILogger<JsonErrorCacheService> logger,
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;

        _cacheFilePath = configuration.GetValue<string>("ErrorCaching:CacheFilePath") ?? "error_cache.json";
        var retryMinutes = configuration.GetValue<int?>("ErrorCaching:RetryIntervalMinutes") ?? 1;
        _retryInterval = TimeSpan.FromMinutes(retryMinutes);
        _serverUrl = configuration.GetValue<string>("ServerUrl") 
                     ?? throw new InvalidOperationException("Server URL is not configured.");

        LoadCacheFromDisk();
    }

    public async Task CacheCommand(string sqlCommand)
    {
        CommandQueue.Enqueue(sqlCommand);
        _logger.LogInformation("Command cached. Current queue size: {QueueSize}", CommandQueue.Count);
        await SaveCacheToDisk();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("JSON Error Cache Service is running.");

        using var timer = new PeriodicTimer(_retryInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            await ProcessQueue(stoppingToken);
            await timer.WaitForNextTickAsync(stoppingToken);
        }
    }

    private async Task ProcessQueue(CancellationToken stoppingToken)
    {
        if (CommandQueue.IsEmpty) return;

        _logger.LogInformation("Processing cached commands. Queue size: {QueueSize}", CommandQueue.Count);
        
        using var client = _httpClientFactory.CreateClient("CacheRetryClient");
        client.BaseAddress = new Uri(_serverUrl);

        while (CommandQueue.TryDequeue(out var sqlCommand))
        {
            if (stoppingToken.IsCancellationRequested) return;

            try
            {
                var content = new StringContent(sqlCommand, Encoding.UTF8, "application/sql");
                var response = await client.PostAsync("", content, stoppingToken);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("Successfully sent cached command.");
                    await SaveCacheToDisk(); // Persist the change (removed item)
                }
                else
                {
                    _logger.LogWarning("Failed to send cached command. Status: {StatusCode}. Re-queuing.", response.StatusCode);
                    CommandQueue.Enqueue(sqlCommand); // Add it back to the end of the queue
                    await SaveCacheToDisk();
                    return; // Stop processing for now, wait for the next interval
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending cached command. Re-queuing.");
                CommandQueue.Enqueue(sqlCommand); // Add it back on failure
                await SaveCacheToDisk();
                return; // Stop processing, wait for the next interval
            }
        }
    }

    private async void LoadCacheFromDisk()
    {
        await FileLock.WaitAsync();
        try
        {
            if (!File.Exists(_cacheFilePath)) return;

            var json = await File.ReadAllTextAsync(_cacheFilePath);
            var commands = JsonSerializer.Deserialize<List<string>>(json);
            if (commands != null)
            {
                foreach (var command in commands)
                {
                    CommandQueue.Enqueue(command);
                }
            }
            _logger.LogInformation("Loaded {Count} commands from cache.", CommandQueue.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load commands from cache file.");
        }
        finally
        {
            FileLock.Release();
        }
    }

    private async Task SaveCacheToDisk()
    {
        await FileLock.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(CommandQueue.ToList());
            await File.WriteAllTextAsync(_cacheFilePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save cache to disk.");
        }
        finally
        {
            FileLock.Release();
        }
    }
}
