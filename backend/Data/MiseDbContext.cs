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
    public DbSet<Preferences> Preferences => Set<Preferences>();
    public DbSet<EquipmentItem> EquipmentItems => Set<EquipmentItem>();
    public DbSet<ShoppingItem> ShoppingItems => Set<ShoppingItem>();
    public DbSet<ShoppingContribution> ShoppingContributions => Set<ShoppingContribution>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<CookLogEntry> CookLog => Set<CookLogEntry>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
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
            e.Property(x => x.AmountValue).HasPrecision(10, 2);
            e.Property(x => x.AmountUnit).HasConversion<string>().HasMaxLength(8);
            e.HasOne(x => x.PantryItem).WithMany().HasForeignKey(x => x.PantryItemId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<PantryItem>(e =>
        {
            e.Property(x => x.Category).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Unit).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Quantity).HasPrecision(10, 2);
            e.Property(x => x.LowThreshold).HasPrecision(10, 2);
            e.Property(x => x.Aliases).HasMaxLength(500);
            e.Property(x => x.Name).HasMaxLength(200);
        });

        b.Entity<Preferences>(e =>
        {
            e.HasMany(x => x.Equipment).WithOne(q => q.Preferences!).HasForeignKey(q => q.PreferencesId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ShoppingItem>(e =>
        {
            e.Property(x => x.Origin).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(200);
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
            e.HasOne(x => x.Recipe).WithMany().HasForeignKey(x => x.RecipeId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.Date, x.Slot }).IsUnique();
        });

        b.Entity<ProfileAnswer>(e =>
        {
            e.Property(x => x.Key).HasMaxLength(100);
            e.HasIndex(x => x.Key).IsUnique();
        });
    }
}
