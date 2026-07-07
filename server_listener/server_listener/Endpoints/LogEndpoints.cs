using ServerListener.Services;

namespace ServerListener.Endpoints;

public static class LogEndpoints
{
    public static void MapLogEndpoints(this WebApplication app)
    {
        app.MapGet("/api/logs", async (LogService logService,
            int page = 1, int pageSize = 30,
            string? eventType = null, string? logName = null,
            string? machineName = null, string? source = null,
            string? search = null, string sortOrder = "desc",
            string? level = null) =>
        {
            var (logs, totalPages) = await logService.GetLogsAsync(
                page, pageSize, eventType, logName,
                machineName, source, search, sortOrder, level);

            return Results.Ok(new { logs, totalPages });
        })
        .RequireHost("*:80");

        app.MapGet("/api/logs/stats", async (LogService logService) =>
        {
            var stats = await logService.GetStatsAsync();
            return Results.Ok(stats);
        })
        .RequireHost("*:80");

        app.MapGet("/api/logs/sources", async (LogService logService) =>
        {
            var sources = await logService.GetSourcesAsync();
            return Results.Ok(sources);
        })
        .RequireHost("*:80");

        app.MapGet("/api/logs/eventtypes", async (LogService logService) =>
        {
            var eventTypes = await logService.GetEventTypesAsync();
            return Results.Ok(eventTypes);
        })
        .RequireHost("*:80");
    }
}
