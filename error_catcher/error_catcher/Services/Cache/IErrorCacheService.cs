namespace ErrorCatcher.Services.Cache;

public interface IErrorCacheService
{
    Task CacheCommand(string sqlCommand);
}
