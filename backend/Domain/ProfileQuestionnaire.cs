namespace Mise.Api.Domain;

public sealed record ProfileQuestion(string Key, string Label, string Type,
    string[]? Options = null, string? Placeholder = null);

public sealed record ProfileSection(string Key, string Title, ProfileQuestion[] Questions);

/// <summary>
/// The kitchen-profile questionnaire: the single source of truth for question keys,
/// Polish labels and choice options. Answers live in <see cref="ProfileAnswer"/> rows
/// keyed by <see cref="ProfileQuestion.Key"/>; adding a question here is all it takes
/// to extend the wizard and the cookbook.md rendering. Types: text | longtext |
/// choice | scale (scale renders 1..5, stored as its string value).
/// </summary>
public static class ProfileQuestionnaire
{
    public static readonly IReadOnlyList<ProfileSection> Sections = new[]
    {
        new ProfileSection("household", "Gospodarstwo", new[]
        {
            new ProfileQuestion("household.people", "Kto je posiłki? (ile osób, wiek, dzieci)", "text",
                Placeholder: "np. 2 dorosłych, córka 6 lat"),
            new ProfileQuestion("household.portions", "Ile porcji zwykle gotujesz i jak duże?", "text",
                Placeholder: "np. 2 duże porcje + lunch na jutro"),
            new ProfileQuestion("household.week", "Jak wygląda typowy tydzień? Kiedy gotujecie w domu, kiedy jecie poza domem?", "longtext",
                Placeholder: "np. pon–czw gotujemy, piątek na mieście…"),
            new ProfileQuestion("household.guests", "Jak często gościcie kogoś na posiłku?", "choice",
                new[] { "prawie nigdy", "raz w miesiącu", "co tydzień" }),
        }),
        new ProfileSection("time", "Czas i umiejętności", new[]
        {
            new ProfileQuestion("time.weeknight", "Ile czasu na gotowanie w dzień powszedni?", "choice",
                new[] { "do 20 min", "20–40 min", "40–60 min", "bez limitu" }),
            new ProfileQuestion("time.weekend", "A w weekend?", "choice",
                new[] { "do 20 min", "20–40 min", "40–60 min", "bez limitu" }),
            new ProfileQuestion("time.skill", "Jak oceniasz swoje umiejętności?", "choice",
                new[] { "początkujący", "średnio zaawansowany", "zaawansowany" }),
            new ProfileQuestion("time.batch", "Gotujesz na zapas (batch cooking)?", "choice",
                new[] { "nigdy", "czasem", "regularnie" }),
            new ProfileQuestion("time.learning", "Czego chcesz się nauczyć w kuchni?", "text",
                Placeholder: "np. domowy makaron, fermentacja"),
        }),
        new ProfileSection("taste", "Smaki", new[]
        {
            new ProfileQuestion("taste.cuisines", "Ulubione kuchnie świata", "text",
                Placeholder: "np. włoska, tajska, bliskowschodnia"),
            new ProfileQuestion("taste.ingredients", "Składniki, które uwielbiacie", "text",
                Placeholder: "np. czosnek, cytryna, kolendra"),
            new ProfileQuestion("taste.heat", "Tolerancja ostrości (1 = łagodnie, 5 = bardzo ostro)", "scale"),
            new ProfileQuestion("taste.textures", "Czego szukacie w daniu? (chrupkość, kremowość, świeżość…)", "text"),
            new ProfileQuestion("taste.comfort", "Danie, do którego zawsze wracacie?", "text",
                Placeholder: "np. carbonara, ramen"),
        }),
        new ProfileSection("avoid", "Unikanie i dieta", new[]
        {
            new ProfileQuestion("avoid.allergies", "Alergie i nietolerancje", "text",
                Placeholder: "np. orzechy, laktoza — puste jeśli brak"),
            new ProfileQuestion("avoid.dislikes", "Składniki, których nie proponować", "text",
                Placeholder: "np. podroby, seler naciowy"),
            new ProfileQuestion("avoid.goals", "Cele dietetyczne", "text",
                Placeholder: "np. więcej białka, mniej cukru, 2 dni wege w tygodniu"),
            new ProfileQuestion("avoid.strictness", "Jak ściśle trzymać się tych zasad?", "choice",
                new[] { "to tylko preferencje", "trzymaj się ściśle" }),
        }),
        new ProfileSection("shopping", "Zakupy", new[]
        {
            new ProfileQuestion("shopping.stores", "Gdzie robicie zakupy? (sklepy, targ, online)", "text",
                Placeholder: "np. Lidl, ryneczek w sobotę"),
            new ProfileQuestion("shopping.frequency", "Jak często?", "choice",
                new[] { "codziennie", "2–3 razy w tygodniu", "raz w tygodniu", "rzadziej" }),
            new ProfileQuestion("shopping.budget", "Wrażliwość na budżet", "choice",
                new[] { "nie patrzę na ceny", "rozsądnie", "oszczędnie" }),
            new ProfileQuestion("shopping.specialty", "Trudno dostępne składniki — proponować?", "choice",
                new[] { "śmiało", "tylko łatwo dostępne" }),
        }),
        new ProfileSection("habits", "Nawyki kuchenne", new[]
        {
            new ProfileQuestion("habits.prep", "Planujecie posiłki z wyprzedzeniem (meal prep)?", "choice",
                new[] { "nie", "luźny plan", "pełny meal prep" }),
            new ProfileQuestion("habits.leftovers", "Co z resztkami?", "text",
                Placeholder: "np. odgrzewamy chętnie / wolimy świeże"),
            new ProfileQuestion("habits.daytime", "Śniadania i lunche — jak to u was wygląda?", "longtext",
                Placeholder: "np. śniadanie w biegu, lunch z wczorajszego obiadu…"),
            new ProfileQuestion("habits.whocooks", "Kto gotuje?", "text",
                Placeholder: "np. na zmianę; w tygodniu ja, w weekend partner"),
            new ProfileQuestion("habits.dishes", "Tolerancja na zmywanie — ile naczyń może zająć przepis?", "choice",
                new[] { "jeden garnek!", "normalnie", "bez znaczenia" }),
        }),
        new ProfileSection("assistant", "Zasady asystenta", new[]
        {
            new ProfileQuestion("assistant.units", "Jednostki i miary", "choice",
                new[] { "gramy i ml", "szklanki i łyżki", "mieszane" }),
            new ProfileQuestion("assistant.servings", "Domyślna liczba porcji", "choice",
                new[] { "1", "2", "3", "4", "6" }),
            new ProfileQuestion("assistant.adventure", "Jak odważne propozycje? (1 = sprawdzone klasyki, 5 = eksperymenty)", "scale"),
            new ProfileQuestion("assistant.airfryer", "Kiedy proponować frytkownicę beztłuszczową?", "choice",
                new[] { "zawsze gdy się da", "gdy ma sens", "rzadko" }),
            new ProfileQuestion("assistant.notes", "Inne zasady dla asystenta", "longtext",
                Placeholder: "np. zawsze podawaj wartości odżywcze; nie proponuj deserów"),
        }),
    };

    public static readonly IReadOnlySet<string> ValidKeys =
        Sections.SelectMany(s => s.Questions).Select(q => q.Key).ToHashSet();

    public static int QuestionCount => Sections.Sum(s => s.Questions.Length);
}
