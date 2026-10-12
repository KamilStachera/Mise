using Microsoft.EntityFrameworkCore;
using Mise.Api.Domain;

namespace Mise.Api.Data;

public class MiseDbContext : DbContext
{
    public MiseDbContext(DbContextOptions<MiseDbContext> options) : base(options) { }

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
    public DbSet<ProfileAnswer> ProfileAnswers => Set<ProfileAnswer>();

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
            e.HasIndex(x => new { x.Merchant, x.NormalizedName }).IsUnique();
            e.HasOne(x => x.PantryItem).WithMany().HasForeignKey(x => x.PantryItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Preferences>(e =>
        {
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
            e.HasIndex(x => x.Checked);
        });

        b.Entity<SupplyFavorite>(e =>
        {
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.NormalizedName).HasMaxLength(200);
            e.HasIndex(x => x.NormalizedName).IsUnique();
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
            e.HasIndex(x => x.CookedAt);
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
            e.HasIndex(x => new { x.Date, x.Slot });
            e.HasIndex(x => x.CookId);
        });

        b.Entity<Cook>(e =>
        {
            e.Property(x => x.Title).HasMaxLength(300);
            e.HasOne(x => x.Recipe).WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.Date);
        });

        b.Entity<BodyProfile>(e =>
        {
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Sex).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.ActivityLevel).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.GoalWeightKg).HasPrecision(5, 1);
            e.Property(x => x.PaceKgPerWeek).HasPrecision(4, 2);
        });

        b.Entity<WeightEntry>(e =>
        {
            e.Property(x => x.Kg).HasPrecision(5, 2);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => x.Date).IsUnique();
        });

        b.Entity<EnergySample>(e =>
        {
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Kcal).HasPrecision(8, 2);
            e.HasIndex(x => new { x.Kind, x.Start, x.End }).IsUnique();
            e.HasIndex(x => x.Date);
        });

        b.Entity<Workout>(e =>
        {
            e.Property(x => x.Type).HasMaxLength(60);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.ExternalKey).HasMaxLength(100);
            e.HasIndex(x => x.ExternalKey).IsUnique();
            e.HasIndex(x => x.Date);
        });

        b.Entity<HealthSync>(e =>
        {
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Token).HasMaxLength(64);
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
            e.HasIndex(x => x.NormalizedName).IsUnique();
            e.HasIndex(x => x.Barcode);
        });

        b.Entity<ProfileAnswer>(e =>
        {
            e.Property(x => x.Key).HasMaxLength(100);
            e.HasIndex(x => x.Key).IsUnique();
        });
    }
}
