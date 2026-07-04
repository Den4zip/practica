namespace ErrorCatcher.Services;

public interface ISqlCommandSender
{
    Task Send(string sqlCommand, CancellationToken cancellationToken);
}
