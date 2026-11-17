# Twilight quiz editorial review — 2026-11-16

## Scope and limits

Reviewed all **200 questions** in `frontend/src/zmierzch/questions/`: 119 in the
initial six files and 81 in `paczka-2.json`. The language review covered every
prompt, correct answer, all three distractors, and every explanation. Revised
122 records; this includes stylistic improvements and clarifications, not 122
incorrect answers. No questions were removed, added, or assigned new IDs, so
existing progress remains associated with the same questions.

This was a full editorial review with **targeted external fact checks** of
suspect claims, not an independent primary-source certification of all 200
facts. No complete licensed Polish subtitle track or complete set of Polish
editions was available for a word-for-word comparison. Unverified Polish
renderings of dialogue are therefore explicitly labelled as explanatory
translations or paraphrases. They must not be described as official subtitles
or quotations from Joanna Urban's translation.

| File | Reviewed | Revised |
| --- | ---: | ---: |
| `ksiezyc-w-nowiu.json` | 18 | 10 |
| `kulisy.json` | 26 | 16 |
| `paczka-2.json` | 81 | 56 |
| `przed-switem.json` | 22 | 14 |
| `saga.json` | 16 | 7 |
| `zacmienie.json` | 17 | 7 |
| `zmierzch.json` | 20 | 12 |
| **Total** | **200** | **122** |

## Important factual and scope corrections

| ID | Finding and correction | Evidence |
| --- | --- | --- |
| `ku-024` | The cover's colours were reversed: the queen is white and the pawn is red. Specified the classic cover because other editions exist. | [Publisher reading guide, including the cover](https://media.btsb.com/TitleLessonPlans/1114.pdf); [Meyer's explanation of the symbolism](https://stepheniemeyer.com/the-books/breaking-dawn/frequently-asked-questions-breaking-dawn/) |
| `ku-026` | A literal retranslation was presented as the Polish epigraph. Restored the published opening and identified Józef Paszkowski as the Shakespeare translator. | [Licensed Polish sample on Legimi, indexed excerpt](https://www.legimi.pl/ebook-ksiezyc-w-nowiu-meyer-stephenie%2Cb982953.html); [Paszkowski's text on Wolne Lektury](https://wolnelektury.pl/katalog/lektura/romeo-i-julia.html) |
| `kn-019` | Bella's job at the Newton store was tagged as both book and film. Changed it to book only and specified the theatrical film in the note. | [Book/film comparison](https://en.wikipedia.org/wiki/New_Moon_%28novel%29); [Store entry](https://twilightsaga.fandom.com/wiki/Newton%27s_Olympic_Outfitters) |
| `zm-022` | The question asserted that Bella fainted. Rephrased it as feeling faint rather than claiming loss of consciousness. | [Twilight chapter 5 summary](https://www.twilightlexicon.com/2006/05/05/chapter-5/) |
| `za-006` | The question said Rosalie died as a human. She was left dying and found alive by Carlisle. | [Rosalie's history](https://twilightsaga.fandom.com/wiki/Rosalie_Hale) |
| `ps-013` | Removed the misleading extra loose note: the farewell is on the torn page and the clue to Jenks is in the book. | [Breaking Dawn chapter 29 summary](https://www.supersummary.com/breaking-dawn/part-3-chapters-29-39-summary/) |
| `ps-034` | The note attributed the whole killing to Caius. Distinguished the guards' action from Caius burning the remains in the book; narrowed the prompt to the execution after the accusation is disproved. | [Breaking Dawn chapter 37 summary](https://www.supersummary.com/breaking-dawn/part-3-chapters-29-39-summary/) |
| `ku-038` | Specified the US publication date, 2005; the Polish edition appeared in 2007. This prevents a reasonable Polish answer from being marked wrong. | [Original editions](https://www.goodreads.com/work/editions/3212258-twilight); [Polish library catalogue](https://www.warszawa-targowek.sowa.pl/index.php?KatID=0&b=e&fauthor=Meyer+Stephenie+%281973-+%29&plnk=q__%2A&sort=byscore&typ=repl) |
| `ku-043` | Removed the unsupported approximately $889 million claim. Kept approximately $830 million for the original theatrical release and distinguished gross receipts from profit. | [Box Office Mojo release totals](https://www.boxofficemojo.com/title/tt1673434.htm/); [Franchise comparison](https://www.boxofficemojo.com/franchise/fr3880226565/?area=XWW&sort=openingNumTheaters&sortDir=asc) |
| `ku-012` | Clarified that the animatronic toddler was rejected, rather than implying it was the finished young Renesmee effect. | [Production account](https://www.abc.net.au/news/2023-08-31/renesmee-twilight-breaking-dawn-lives-in-my-head-rent-free/102784590) |
| `ps-036` | Specified the ending before the credits, since the note already correctly mentions the later Volturi scene. | Internal prompt/note consistency correction. |
| `ps-020` | Replaced the ambiguous pronoun after Amun: Rami Malek plays Benjamin. | [Polish film pressbook](https://kinomaniak.pl/film/pressbook/2335/the-twilight-saga-breaking-dawn-part-2) |

The Legimi page could be verified through its indexed licensed excerpt; direct
page retrieval failed. The epigraph's wording was also checked against the
public-domain Shakespeare translation on Wolne Lektury.

## Polish language and translation decisions

- Prompts and answer choices now use Polish for spoken dialogue. Useful English
  originals remain in the explanations, alongside Polish meaning and a clear
  translation/paraphrase label (`zm-010`, `zm-011`, `zm-012`, `zm-024`, `za-008`,
  `sa-027`). Proper names and original song titles remain unchanged.
- `za-008`: explain both meanings of “hotter”: body temperature and attractiveness.
- `zm-012`: explain “spider monkey” as a czepiak, while using the natural affectionate
  “małpko” in the explanatory Polish rendering. Do not claim an official subtitle.
- `zm-025`: replace the awkward “własna marka heroiny” question with a question
  about the comparison to heroin; retain the book/film speaker distinction.
- `sa-028`, `sa-029`, `ps-007`: replace calques such as “na kim wpoił się” and
  “wpaja się w nią” with natural descriptions of the bond called “wpojenie”.
- `kn-021`: “broni Bellę” → “broni Belli”.
- `sa-025`: “Jak brzmiało ludzkie imię i nazwisko” → “Jak brzmiały pełne imię
  i nazwisko”.
- `sa-016`: “w jakim mieście i wieku” → “w jakim mieście i w którym stuleciu”.
- `sa-014`: remove “która z wilczyc”, since the distractors are not all wolves.
- Align answer cases with the prompts, including “na biologii”, “z Phoenix”,
  “w Chicago”, “w baseball”, “Dnia Świętego Marka”, and “w wieku około 7 lat”.
- Use the conventional Polish title “Sonata księżycowa” for Beethoven, instead
  of the literal “Światło księżyca”. Keep Debussy's “Clair de lune” unchanged.
- Replace “soundtrack”, “cameo” and untranslated explanatory dialogue where a
  simple Polish expression works. Remove the authoring remark “dobry dystraktor”
  from the player-facing note in `ps-005`.
- Clarify ambiguous pronouns, distinguish interpretation from fact, and remove
  unnecessary absolutes such as Alice knowing the future with certainty.
- Retain capitalized car names under the rules effective from January 2026
  ([Polish Language Council](https://rjp.pan.pl/komunikat-rady-jezyka-polskiego-przy-prezydium-pan-z-dnia-16-czerwca-2025-r/)).
  Preserve both capitals in “Wichrowe Wzgórza”, also the name of the fictional
  estate ([publisher](https://www.proszynski.pl/product/wichrowe-wzgorza-2)).

## Validation and delivery

The existing data validator checks JSON, IDs, enums, four distinct options, and
duplicate question text. Added focused checks for the cover, Polish epigraph,
book-only job, US publication date, pre-credit ending, and dialogue translation
labels. These checks do not attempt automatic assessment of Polish fluency.

Validation results:

- `cd frontend; npm run test:zmierzch`: passed for all 200 questions.
- `cd frontend; npm run build`: TypeScript and Vite production build passed.
  Vite reports a non-blocking bundle-size warning (main JS chunk above 500 kB).
- Updated validator against the original `HEAD` question bank, without rewriting
  the working files: failed as expected with 17 findings, including the reversed
  cover, incorrect epigraph and incorrect book/film tag.
- All 200 IDs, record order and per-file counts match the original bank.
  All 1,200 player-facing text fields are present and have no replacement
  characters or leading/trailing whitespace.
- `git diff --check`: passed. Scoped diff reviewed; no end-to-end browser or
  production verification was performed for these static content changes.

Changes are local frontend content and tests. No API, database, Docker service,
or production site was changed. No migration, backend restart, MCP rebuild, or
context regeneration is needed. Production will receive the corrected bank
only after a separately authorized frontend build/deployment.

Pre-existing unrelated work was preserved: `.claude/settings.json`,
`.env.example`, `frontend/src/components/ConnectAgentCard.tsx`,
`frontend/tsconfig.tsbuildinfo`, and `.claude/worktrees/`.
