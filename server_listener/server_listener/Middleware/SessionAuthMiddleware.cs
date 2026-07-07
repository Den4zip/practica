using ServerListener.Services;

namespace ServerListener.Middleware;

public class SessionAuthMiddleware
{
    private readonly RequestDelegate _next;

    public SessionAuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, AuthService authService)
    {
        if (context.Request.Host.Port != 8080 &&
            !context.Request.Path.StartsWithSegments("/api/auth"))
        {
            if (!context.Request.Cookies.TryGetValue("beacon_session", out var token) ||
                !authService.IsValid(token))
            {
                if (context.Request.Path.StartsWithSegments("/api/"))
                {
                    context.Response.StatusCode = 401;
                    return;
                }
            }
        }

        await _next(context);
    }
}
