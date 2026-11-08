using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Mise.Api.Domain;
using Mise.Api.Services;

namespace Mise.Api.Data;

/// <summary>
/// Multi-household: every <see cref="IHouseholdOwned"/> table carries <c>HouseholdId</c>, hidden from
/// other households by a global query filter (children filter through their parent) and stamped on
/// insert from <see cref="TenantContext"/>. Saving refuses cross-household writes.
/// </summary>
public class MiseDbContext : DbContext
{
    private readonly TenantContext _tenant;

    public MiseDbContext(DbContextOptions<MiseDbContext> options, TenantContext tenant) : base(options) => _tenant = tenant;

    /// <summary>Tests and design-time tooling only: acts for household 1.</summary>
    public MiseDbContext(DbContextOptions<MiseDbContext> options) : this(options, TenantContext.For(1)) { }

    public TenantContext Tenant => _tenant;

    // Read by the query filters; EF re-evaluates them per query, so a tenant switch takes effect immediately.
    private bool TenantIsSystem => _tenant.IsSystem;
    private int? TenantHouseholdId => _tenant.HouseholdId;

    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<RecipeStep> RecipeSteps => Set<RecipeStep>();
    public DbSet<RecipeImage> RecipeImages => Set<RecipeImage>();
    public DbSet<PantryItem> PantryItems => Set<PantryItem>();
    public DbSet<ReceiptNameMapping> ReceiptNameMappings => Set<ReceiptNameMapping>();
    public DbSet<Preferences> Preferences => Set<Preferences>();
    public DbSet<EquipmentItem> EquipmentItems => Set<EquipmentItem>();
    public DbSet<ShoppingItem> ShoppingItems => Set<ShoppingItem>();
    public DbSet<ShoppingContribution> ShoppingContributions => Set<ShoppingContribution>();
    public DbSet<SupplyItem> SupplyItems => Set<SupplyItem>();
    public DbSet<SupplyFavorite> SupplyFavorites => Set<SupplyFavorite>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<CookLogEntry> CookLog => Set<CookLogEntry>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
    public DbSet<Cook> Cooks => Set<Cook>();
    public DbSet<FoodFavorite> FoodFavorites => Set<FoodFavorite>();
    public DbSet<BodyProfile> BodyProfiles => Set<BodyProfile>();
    public DbSet<WeightEntry> WeightEntries => Set<WeightEntry>();
    public DbSet<EnergySample> EnergySamples => Set<EnergySample>();
    public DbSet<Workout> Workouts => Set<Workout>();
    public DbSet<HealthSync> HealthSyncs => Set<HealthSync>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<Catering> Caterings => Set<Catering>();
    public DbSet<ProfileAnswer> ProfileAnswers => Set<ProfileAnswer>();
    public DbSet<Exercise> Exercises => Set<Exercise>();
    public DbSet<TrainingProfile> TrainingProfiles => Set<TrainingProfile>();
    public DbSet<TrainingProgram> TrainingPrograms => Set<TrainingProgram>();
    public DbSet<ProgramDay> ProgramDays => Set<ProgramDay>();
    public DbSet<ProgramExercise> ProgramExercises => Set<ProgramExercise>();
    public DbSet<Household> Households => Set<Household>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<InviteCode> InviteCodes => Set<InviteCode>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // store enums as readable strings
        b.Entity<Recipe>(e =>
        {
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.DishType).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Cuisine).HasConversion<string>().HasMaxLength(24);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.SourceName).HasMaxLength(80);
            e.Property(x => x.Tint).HasMaxLength(16);
            e.HasMany(x => x.Ingredients).WithOne(i => i.Recipe!).HasForeignKey(i => i.RecipeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Steps).WithOne(s => s.Recipe!).HasForeignKey(s => s.RecipeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Images).WithOne(i => i.Recipe!).HasForeignKey(i => i.RecipeId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RecipeImage>(e =>
        {
            e.Property(x => x.Path).HasMaxLength(260);
            e.HasIndex(x => x.RecipeId);
        });

        b.Entity<RecipeIngredient>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Quantity).HasMaxLength(100);
            e.Property(x => x.DisplayText).HasMaxLength(500);
            e.Property(x => x.AlternativeGroup).HasMaxLength(100);
            e.Property(x => x.AmountValue).HasPrecision(10, 2);
            e.Property(x => x.AmountUnit).HasConversion<string>().HasMaxLength(8);
            e.HasOne(x => x.PantryItem).WithMany().HasForeignKey(x => x.PantryItemId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<PantryItem>(e =>
        {
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Unit).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Quantity).HasPrecision(10, 2);
            e.Property(x => x.ReliableQuantity).HasPrecision(10, 2);
            e.Property(x => x.LowThreshold).HasPrecision(10, 2);
            e.Property(x => x.Aliases).HasMaxLength(500);
            e.Property(x => x.Name).HasMaxLength(200);
        });

        b.Entity<ReceiptNameMapping>(e =>
        {
            e.Property(x => x.Merchant).HasMaxLength(120);
            e.Property(x => x.RawName).HasMaxLength(300);
            e.Property(x => x.NormalizedName).HasMaxLength(300);
            e.HasIndex(x => new { x.HouseholdId, x.Merchant, x.NormalizedName }).IsUnique();
            e.HasOne(x => x.PantryItem).WithMany().HasForeignKey(x => x.PantryItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Preferences>(e =>
        {
            e.HasIndex(x => x.HouseholdId).IsUnique();
            e.HasMany(x => x.Equipment).WithOne(q => q.Preferences!).HasForeignKey(q => q.PreferencesId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ShoppingItem>(e =>
        {
            e.Property(x => x.Origin).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.AlternativeKey).HasMaxLength(1000);
            e.Property(x => x.AlternativePantryItemIds).HasMaxLength(1000);
            e.Property(x => x.Quantity).HasPrecision(10, 2);
            e.Property(x => x.Unit).HasConversion<string>().HasMaxLength(8);
            e.HasIndex(x => x.PantryItemId);
            e.HasMany(x => x.Contributions).WithOne(x => x.ShoppingItem!)
                .HasForeignKey(x => x.ShoppingItemId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ShoppingContribution>(e =>
        {
            e.Property(x => x.SourceKey).HasMaxLength(100);
            e.Property(x => x.SourceLabel).HasMaxLength(300);
            e.Property(x => x.RequiredQuantity).HasPrecision(10, 2);
            e.Property(x => x.Unit).HasConversion<string>().HasMaxLength(8);
            e.HasIndex(x => x.SourceKey);
            e.HasIndex(x => new { x.ShoppingItemId, x.SourceKey });
        });

        b.Entity<SupplyItem>(e =>
        {
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(200);
            e.HasIndex(x => new { x.HouseholdId, x.Checked });
        });

        b.Entity<SupplyFavorite>(e =>
        {
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.NormalizedName).HasMaxLength(200);
            e.HasIndex(x => new { x.HouseholdId, x.NormalizedName }).IsUnique();
        });

        b.Entity<ChatMessage>(e =>
        {
            e.Property(x => x.Role).HasMaxLength(8);
            e.HasIndex(x => new { x.SessionId, x.CreatedAt });
        });

        b.Entity<CookLogEntry>(e =>
        {
            e.Property(x => x.DishName).HasMaxLength(300);
            e.HasOne(x => x.Recipe).WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.HouseholdId, x.CookedAt });
            e.HasIndex(x => x.RecipeId);
        });

        b.Entity<PlanEntry>(e =>
        {
            e.Property(x => x.Slot).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Portions).HasPrecision(6, 2);
            e.Property(x => x.Grams).HasPrecision(8, 1);
            e.Property(x => x.Protein).HasPrecision(7, 1);
            e.Property(x => x.Fat).HasPrecision(7, 1);
            e.Property(x => x.Carbs).HasPrecision(7, 1);
            e.HasOne(x => x.Recipe).WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Cook).WithMany(c => c.Entries).HasForeignKey(x => x.CookId).OnDelete(DeleteBehavior.SetNull);
            // Several entries per slot now (snacks, a leftover next to a fresh meal) — not unique.
            e.HasIndex(x => new { x.HouseholdId, x.Date, x.Slot });
            e.HasIndex(x => x.CookId);
            e.HasIndex(x => new { x.PersonId, x.Date });
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Cook>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(300);
            e.HasOne(x => x.Recipe).WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.Date);
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Person>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60);
            // Stored lower-case (People.NormalizeEmail): one Google account = one person = one household.
            e.Property(x => x.Email).HasMaxLength(200);
            e.HasIndex(x => x.Email).IsUnique().HasFilter("\"Email\" IS NOT NULL");
        });

        b.Entity<Household>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80);
        });

        b.Entity<InviteCode>(e =>
        {
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Starter).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.CodeHash).HasMaxLength(64);
            e.Property(x => x.HouseholdName).HasMaxLength(80);
            e.HasIndex(x => x.CodeHash).IsUnique();
            e.HasIndex(x => x.HouseholdId);
            e.HasOne<Household>().WithMany().HasForeignKey(x => x.HouseholdId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ApiKey>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.KeyHash).HasMaxLength(64);
            e.Property(x => x.Prefix).HasMaxLength(16);
            e.HasIndex(x => x.KeyHash).IsUnique();
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Catering>(e =>
        {
            e.HasKey(x => x.PersonId);
            e.Property(x => x.PersonId).ValueGeneratedNever();
            e.Property(x => x.Protein).HasPrecision(7, 1);
            e.Property(x => x.Fat).HasPrecision(7, 1);
            e.Property(x => x.Carbs).HasPrecision(7, 1);
            e.HasOne<Person>().WithOne().HasForeignKey<Catering>(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<BodyProfile>(e =>
        {
            e.HasKey(x => x.PersonId);
            e.Property(x => x.PersonId).ValueGeneratedNever();
            e.HasOne<Person>().WithOne().HasForeignKey<BodyProfile>(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Sex).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.ActivityLevel).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.GoalWeightKg).HasPrecision(5, 1);
            e.Property(x => x.PaceKgPerWeek).HasPrecision(4, 2);
        });

        b.Entity<WeightEntry>(e =>
        {
            e.Property(x => x.Kg).HasPrecision(5, 2);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => new { x.PersonId, x.Date }).IsUnique();
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<EnergySample>(e =>
        {
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Kcal).HasPrecision(8, 2);
            e.HasIndex(x => new { x.PersonId, x.Kind, x.Start, x.End }).IsUnique();
            e.HasIndex(x => new { x.PersonId, x.Date });
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Workout>(e =>
        {
            e.Property(x => x.Type).HasMaxLength(60);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.ExternalKey).HasMaxLength(100);
            e.HasIndex(x => new { x.PersonId, x.ExternalKey }).IsUnique();
            e.HasIndex(x => new { x.PersonId, x.Date });
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<HealthSync>(e =>
        {
            e.HasKey(x => x.PersonId);
            e.Property(x => x.PersonId).ValueGeneratedNever();
            e.Property(x => x.Token).HasMaxLength(64);
            e.HasOne<Person>().WithOne().HasForeignKey<HealthSync>(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<FoodFavorite>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.NormalizedName).HasMaxLength(200);
            e.Property(x => x.Barcode).HasMaxLength(32);
            e.Property(x => x.Protein).HasPrecision(7, 1);
            e.Property(x => x.Fat).HasPrecision(7, 1);
            e.Property(x => x.Carbs).HasPrecision(7, 1);
            e.Property(x => x.LastGrams).HasPrecision(8, 1);
            e.HasIndex(x => new { x.PersonId, x.NormalizedName }).IsUnique();
            e.HasIndex(x => x.Barcode);
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ProfileAnswer>(e =>
        {
            e.Property(x => x.Key).HasMaxLength(100);
            e.HasIndex(x => new { x.HouseholdId, x.Key }).IsUnique();
        });

        b.Entity<Exercise>(e =>
        {
            e.Property(x => x.SourceId).HasMaxLength(100);
            e.HasIndex(x => x.SourceId).IsUnique();
            e.HasOne<Household>().WithMany().HasForeignKey(x => x.HouseholdId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.NameEn).HasMaxLength(200);
            e.Property(x => x.NamePl).HasMaxLength(200);
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(24);
            e.Property(x => x.Level).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Force).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Mechanic).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Equipment).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.YoutubeId).HasMaxLength(16);
            e.Property(x => x.VideoTitle).HasMaxLength(300);
            e.Property(x => x.VideoChannel).HasMaxLength(200);
        });

        b.Entity<TrainingProfile>(e =>
        {
            e.HasKey(x => x.PersonId);
            e.Property(x => x.PersonId).ValueGeneratedNever();
            e.HasOne<Person>().WithOne().HasForeignKey<TrainingProfile>(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Goal).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Level).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Location).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Limitations).HasMaxLength(1000);
            e.Property(x => x.Dislikes).HasMaxLength(1000);
            e.Property(x => x.Notes).HasMaxLength(1000);
        });

        b.Entity<TrainingProgram>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Rationale).HasMaxLength(4000);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.CreatedBy).HasMaxLength(16);
            e.HasIndex(x => new { x.PersonId, x.Status });
            // One active program per person; the service archives the previous one first.
            e.HasIndex(x => x.PersonId).IsUnique().HasFilter("\"Status\" = 'Active'")
                .HasDatabaseName("IX_TrainingPrograms_PersonId_Active");
            e.HasOne<Person>().WithMany().HasForeignKey(x => x.PersonId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Days).WithOne(d => d.Program!).HasForeignKey(d => d.ProgramId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ProgramDay>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Location).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.Property(x => x.VideoYoutubeId).HasMaxLength(16);
            e.Property(x => x.VideoTitle).HasMaxLength(300);
            e.Property(x => x.WorkoutType).HasMaxLength(60);
            e.HasIndex(x => new { x.ProgramId, x.Week, x.Weekday }).IsUnique();
            e.HasMany(x => x.Exercises).WithOne(p => p.Day!).HasForeignKey(p => p.ProgramDayId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ProgramExercise>(e =>
        {
            e.Property(x => x.TargetKg).HasPrecision(6, 2);
            e.Property(x => x.Notes).HasMaxLength(300);
            e.Property(x => x.SupersetGroup).HasMaxLength(8);
            // An exercise used by a plan can't vanish from the catalog (hide it instead).
            e.HasOne(x => x.Exercise).WithMany().HasForeignKey(x => x.ExerciseId).OnDelete(DeleteBehavior.Restrict);
        });

        ConfigureTenancy(b);
    }

    private void ConfigureTenancy(ModelBuilder b)
    {
        // Every household-owned root table: FK to Households + `IsSystem || HouseholdId == tenant`.
        foreach (var type in b.Model.GetEntityTypes().Select(t => t.ClrType).ToList())
        {
            if (!typeof(IHouseholdOwned).IsAssignableFrom(type)) continue;
            b.Entity(type).HasOne(typeof(Household)).WithMany()
                .HasForeignKey(nameof(IHouseholdOwned.HouseholdId)).OnDelete(DeleteBehavior.Restrict);
            b.Entity(type).HasQueryFilter(OwnedFilter(type));
        }

        // Children are filtered through their parent, so a lookup by id can't reach across households.
        b.Entity<RecipeIngredient>().HasQueryFilter(e => TenantIsSystem || e.Recipe!.HouseholdId == TenantHouseholdId);
        b.Entity<RecipeStep>().HasQueryFilter(e => TenantIsSystem || e.Recipe!.HouseholdId == TenantHouseholdId);
        b.Entity<RecipeImage>().HasQueryFilter(e => TenantIsSystem || e.Recipe!.HouseholdId == TenantHouseholdId);
        b.Entity<EquipmentItem>().HasQueryFilter(e => TenantIsSystem || e.Preferences!.HouseholdId == TenantHouseholdId);
        b.Entity<ShoppingContribution>().HasQueryFilter(e => TenantIsSystem || e.ShoppingItem!.HouseholdId == TenantHouseholdId);
        b.Entity<ProgramDay>().HasQueryFilter(e => TenantIsSystem || e.Program!.HouseholdId == TenantHouseholdId);
        b.Entity<ProgramExercise>().HasQueryFilter(e => TenantIsSystem || e.Day!.Program!.HouseholdId == TenantHouseholdId);
        // The shared catalog (null) plus this household's custom exercises.
        b.Entity<Exercise>().HasQueryFilter(e => TenantIsSystem || e.HouseholdId == null || e.HouseholdId == TenantHouseholdId);
    }

    /// <summary><c>e => this.TenantIsSystem || (int?)e.HouseholdId == this.TenantHouseholdId</c> for a concrete type.</summary>
    private LambdaExpression OwnedFilter(Type type)
    {
        var e = Expression.Parameter(type, "e");
        var ctx = Expression.Constant(this);
        var system = Expression.Property(ctx, nameof(TenantIsSystem));
        var tenant = Expression.Property(ctx, nameof(TenantHouseholdId));
        var owner = Expression.Convert(Expression.Property(e, nameof(IHouseholdOwned.HouseholdId)), typeof(int?));
        return Expression.Lambda(Expression.OrElse(system, Expression.Equal(owner, tenant)), e);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyTenantRules();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ApplyTenantRules();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>
    /// Stamps new rows with the tenant's household and refuses writes to another household's rows.
    /// System scopes may write anywhere but must set <c>HouseholdId</c> on new rows themselves.
    /// </summary>
    private void ApplyTenantRules()
    {
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            var name = entry.Metadata.ClrType.Name;

            if (entry.Entity is IHouseholdOwned owned)
            {
                if (entry.State == EntityState.Added && owned.HouseholdId == 0)
                    owned.HouseholdId = _tenant.HouseholdId
                        ?? throw new TenantViolationException($"New {name} has no household (a system scope must set HouseholdId).");
                if (!_tenant.IsSystem && owned.HouseholdId != _tenant.HouseholdId)
                    throw new TenantViolationException($"{name} belongs to household {owned.HouseholdId}, not {_tenant.HouseholdId}.");
                if (entry.State == EntityState.Modified && !_tenant.IsSystem
                    && entry.Property(nameof(IHouseholdOwned.HouseholdId)).IsModified)
                    throw new TenantViolationException($"{name} can't move between households.");
            }

            if (entry.State == EntityState.Added && entry.Entity is IPersonOwned { PersonId: 0 })
                throw new TenantViolationException($"New {name} has no person.");

            // An exercise an agent adds (no free-exercise-db id) belongs to that household only.
            if (entry is { State: EntityState.Added, Entity: Exercise { HouseholdId: null, SourceId: null } custom }
                && _tenant.HouseholdId is int household)
                custom.HouseholdId = household;
        }
    }
}
