using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Mise.Api.Data;

/// <summary>
/// Used by `dotnet ef` at design time so migrations can be generated without
/// running application startup or needing a live database.
/// </summary>
public class MiseDbContextFactory : IDesignTimeDbContextFactory<MiseDbContext>
{
    public MiseDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
            ?? "Host=localhost;Port=5432;Database=mise;Username=mise;Password=mise_dev_password";
        var options = new DbContextOptionsBuilder<MiseDbContext>()
            .UseNpgsql(cs)
            .Options;
        return new MiseDbContext(options);
    }
}
