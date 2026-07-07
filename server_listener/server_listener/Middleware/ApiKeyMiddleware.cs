using Microsoft.Extensions.Primitives;

namespace ServerListener.Middleware;

public class ApiKeyMiddleware
{
    private readonly RequestDelegate _next;

    public ApiKeyMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IConfiguration configuration)
    {
        if (context.Request.Path == "/query" && context.Request.Host.Port == 8080)
        {
            if (!context.Request.Headers.TryGetValue("X-Api-Key", out StringValues extractedApiKey))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("API Key was not provided.");
                return;
            }

            var apiKey = configuration.GetValue<string>("Security:ApiKey");
            if (apiKey != null && !apiKey.Equals(extractedApiKey))
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync("Unauthorized client.");
                return;
            }
        }

        await _next(context);
    }
}
