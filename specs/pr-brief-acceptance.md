# PR Brief — критерії приймання (L05, домашнє завдання «PR Why + Risk Brief»)

Критерії переписані з умови завдання дослівно. Спеку пише `spec-creator`
([`2026-10-05-pr-brief.md`](2026-10-05-pr-brief.md), SPEC-02), план —
`implementation-planner`; цей файл — контрольний список, за яким обидва артефакти й код
перевіряються тричі: після спеки, після плану, після реалізації.

Позначки в колонках: ID критерію спеки / етап плану / `файл:рядок` або тест — враховано;
`—` — ще не перевірялось; `✗` — не враховано; `поза кодом` — результат процесу, а не поведінка.

## P1 — блокують здачу

| ID | Критерій | Спека | План | Код |
|---|---|---|---|---|
| P1-1 | На вкладці Overview є блок PR Brief; поки брифу немає, видно кнопку Generate brief. | AC-1, AC-2, AC-5 | Stage 7, 8 | `PrBriefSummary.tsx:67` (кнопка) · `PrBriefSummary.test.tsx`, `OverviewTab.test.tsx` |
| P1-2 | Після генерації видно підсумок (що робить PR і навіщо), Risk areas і Review focus. Intent і Blast radius стоять у брифі поруч, якщо вони є; якщо немає — бриф генерується без них і прямо пише, яких даних бракує. | AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13 | Stage 5, 6, 8 | `OverviewTab.tsx`, `PrBriefSummary.tsx:130` (чого бракує), `brief/service.ts` · `brief.it.test.ts`, `OverviewTab.test.tsx` |
| P1-3 | Кожен ризик має назву й файл, кожен пункт Review focus — `файл:рядок` і причину. | AC-14, AC-18, AC-20, AC-22 | Stage 3, 8 | `BriefRiskAreas.tsx`, `BriefReviewFocus.tsx:27-33`, `brief/helpers.ts:30` · `brief-helpers.test.ts` |
| P1-4 | Усі файли в Risk areas і Review focus справді є в цьому PR або в карті Blast radius, якщо вона є, — вигаданих шляхів немає. | AC-21, AC-22, AC-23, AC-24 | Stage 3, 5, 6 | `brief/helpers.ts:20,30` (`allowedFiles`, `validateAnswer`), `brief/service.ts:110` · `brief-helpers.test.ts`, `brief.it.test.ts` |
| P1-5 | Клік на пункт Review focus відкриває вкладку Files changed на цьому файлі. | AC-25, AC-26 | Stage 7, 8, 9 | `pulls/[number]/helpers.ts` (`diffTargetHref`), `DiffTab.tsx`, `FileCard.tsx:70` · `DiffTab.test.tsx`, `BriefReviewFocus.test.tsx` |
| P1-6 | Після перезавантаження сторінки бриф з’являється одразу, без нової генерації, а кнопка оновлення генерує його заново. | AC-29, AC-30, AC-31, AC-35, AC-36, AC-37, NFR-3 | Stage 5, 6, 7, 8 | `brief/repository.ts`, `brief/routes.ts:11,20`, `PrBriefSummary.tsx:110` (оновлення) · `brief.it.test.ts`, `PrBriefSummary.test.tsx` |
| P1-7 | У PR є `spec.md` і `plan.md`, які створили агенти `spec-creator` і `implementation-planner`. | поза кодом (NG-9) | поза кодом | коміт `f715a2c` |
| P1-8 | Є відкритий PR з описом реалізації та демо-відео. | поза кодом (NG-9) | поза кодом | за користувачем; текст — `PR_BODY-l05-pr-brief.md` |

## P2 — не блокують, ментор коментує в PR

| ID | Критерій | Спека | План | Код |
|---|---|---|---|---|
| P2-1 | `spec.md` і `plan.md` закомічені раніше за код фічі. | поза кодом (NG-9) | поза кодом | `f715a2c` передує коду |
| P2-2 | В описі PR є коротка нотатка cross-model review: яка модель рев’юїла план і що знайшла. | поза кодом (NG-9) | поза кодом | `PR_BODY-l05-pr-brief.md` § Cross-model review |
| P2-3 | Фінальний звіт `plan-verifier` доданий до PR і не містить незакритих вимог. | поза кодом (NG-9) | поза кодом | `PR_BODY-l05-pr-brief.md` § plan-verifier report |
| P2-4 | Генерація брифу — рівно один виклик моделі, і це видно в trace або логах. | AC-45, AC-64, AC-65, NFR-7 | Stage 2, 5, 6, 8 | `brief/service.ts:187` (єдиний `completeStructured`), `:137` (лог `brief.generated`) · `brief-service.test.ts` |
| P2-5 | Вхід виклику не перевищує бюджету зі спеки, а тіла diff hunks у модель не потрапляють. | NFR-1, NFR-2, AC-41, AC-42, AC-51, AC-61 | Stage 2, 3, 4, 5 | `brief/constants.ts:3` (8000), `brief/budget.ts:129`, у `render.ts` і `budget.ts` немає `patch` · `brief-input.test.ts` |
| P2-6 | Відповідь моделі проходить валідацію контрактом; `summary` і `review_focus` додані в обидві копії `brief.ts`. | AC-47, AC-48, NFR-8 | Stage 1, 5, 6 | `contracts/brief.ts:159-172` в обох копіях (ідентичні), `brief/service.ts:187` · `contracts.test.ts` |
| P2-7 | Модель береться з налаштування `risk_brief`, а не зашита в код. | AC-46 | Stage 1, 5, 6 | `brief/service.ts:52` (`resolveFeatureModel(…, risk_brief)`) · `brief.it.test.ts` |
| P2-8 | Кеш прив’язаний до SHA: після нового коміту в PR бриф позначено як застарілий або він генерується заново. | AC-29, AC-52, AC-53 | Stage 5, 6, 8 | `brief/helpers.ts:81` (`stale`), `PrBriefSummary.tsx:123` · `brief.it.test.ts` |
| P2-9 | Клік на пункт Review focus прокручує diff саме до потрібного рядка. | AC-54, AC-62 | Stage 3, 9 | `FileCard.tsx:70` (прокрутка до рядка), `brief/helpers.ts:30` (рядок у зміненому діапазоні) · `DiffTab.test.tsx` |

## P3 — побажання

| ID | Критерій | Спека | План | Код |
|---|---|---|---|---|
| P3-1 | Банер зверху з вердиктом і PR score з останнього рев’ю, як на скріншоті (компонент `VerdictBanner` уже є). | AC-55, AC-56 | Stage 8 | `PrBriefSummary.tsx:93` (`VerdictBanner`) · `PrBriefSummary.test.tsx` |
| P3-2 | Ризик розгортається й показує пояснення (`explanation`). | AC-57 | Stage 8 | `BriefRiskAreas.tsx:71-79` · `BriefRiskAreas.test.tsx` |
| P3-3 | Клік на ризик теж веде до файла на Files changed. | AC-58 | Stage 7, 8 | `BriefRiskAreas.tsx:60` · `BriefRiskAreas.test.tsx`, `OverviewTab.test.tsx` |
| P3-4 | Якщо файла немає в diff цього PR, з’являється коротке повідомлення «File not in this PR’s diff». | AC-59 | Stage 7, 9 | `DiffTab.tsx:163` · `DiffTab.test.tsx` |
| P3-5 | Поки бриф генерується, замість порожнього місця видно skeleton. | AC-60 | Stage 8 | `PrBriefSummary.tsx:71-73` · `PrBriefSummary.test.tsx` |
| P3-6 | Підписи блоків не зашиті в компонент, а беруться з `client/messages/en/brief.json`. | NFR-10 | Stage 7, 8, 9 | `client/messages/en/brief.json`; зонд `client/src/test/catalog-probe.ts` у тестах компонентів |
| P3-7 | До PR додано результат `workflow-retro` і cost report прогону. | поза кодом (NG-9) | поза кодом | за користувачем (`/workflow-retro`) |

## Як перевірити (сценарій відео)

| ID | Крок |
|---|---|
| V-1 | Відкрити тестовий pull request → вкладка Overview → показати кнопку Generate brief і натиснути її. |
| V-2 | Показати готовий бриф: підсумок, Risk areas і Review focus, а також Intent і Blast radius, якщо вони є. |
| V-3 | Клікнути на пункт Review focus → відкриється Files changed на цьому файлі. |
| V-4 | Перезавантажити сторінку → бриф на місці одразу, без нової генерації. |
| V-5 | Коротко показати в PR `spec.md`, `plan.md` і звіт `plan-verifier`. |
| V-6 | Одним реченням сказати, чому модель отримує готові факти, а не код diff. |

Покроковий сценарій зі словами — `DEMO_SCRIPT-pr-brief.md` у корені репозиторію.

## Журнал перевірок

| Крок | Дата | Результат |
|---|---|---|
| Після спеки | 2026-10-05 | SPEC-02 `approved` (68 AC, 12 NFR; `check-spec.sh --for-approval` — ok): усі 18 продуктових критеріїв мають AC або NFR, 6 процесних винесені в NG-9. P2-9 підкріплено AC-61/AC-62: рядок Review focus мусить лежати в діапазоні змінених рядків файла. Застереження: P2-8 — `head_sha` PR оновлюється лише після синку списку PR (EC-14), тож «застарів» з’явиться після нього. Відкриті неблокувальні: OQ-13 (модель-дефолт `risk_brief`), OQ-14 (пункт на файлі без змінених рядків). |
| Після плану | 2026-10-05 | План `2026-10-05-pr-brief-plan.md` (9 етапів): кожен із 68 AC і 12 NFR названий в етапі або в §6, усі 18 продуктових критеріїв мають етап. Cross-model review (`z-ai/glm-5.1`): 7 знахідок, після перевірки в коді слушна одна — NFR-10 (P3-6) без перевірки «немає рядкових літералів». Ревізія 2 плану її закриває (catalog probe в етапах 7–9, grep і `plan-verifier` у §6) і додає прийняті рекомендації: summary не з самих пробілів (R1), генерація без подвійної помилки (R2). Режим — multi-agent; блокувальних питань немає. Ризик strict-схеми закрито живим запитом. |
| Після реалізації | 2026-10-05 | Код зібрано вісьмома брифами; `plan-verifier`: 165 виконано, 0 пропущено, 4 задекларовані відхилення, усі 68 AC — done; `architecture-reviewer`: без CRITICAL і WARNING. Тести: сервер 442 unit + 163 integration, клієнт 411, mcp 309. Усі 18 продуктових критеріїв мають код і тест. За користувачем: P1-8 (PR і відео), P3-7 (retro). |
| Жива перевірка | 2026-10-06 | Dev-стек, PR #6 (100 файлів). Знайдено: з дефолтом `deepseek/deepseek-v4-flash` генерація двічі з двох упала з таймаутом 60 с (модель витрачає 1,5–3 тис. токенів на приховані міркування). Користувач змінив дефолт `risk_brief` на `minimax/minimax-m2.5` (AC-66 без змін). Після правки: 200 за 9,6 с, `attempts: 1`, вхід 5 202 з 8 000 токенів, 4 ризики і 5 пунктів Review focus, нічого не відкинуто. У браузері підтверджено P1-1 … P1-6, P2-4, P2-5, P2-7, P2-9, P3-2, P3-3: блоки на Overview, клік на Review focus → Files changed з обведеною карткою й рядком у полі зору, Back → Overview, перезавантаження без нового POST. `security-reviewer`: один WARNING (вихід тексту автора з блоку `untrusted`), виправлено в `brief/render.ts`. Тести після правок: сервер 445 unit + 163 integration, клієнт 411. Фінальна повторна перевірка `plan-verifier`: 162 виконано, 0 пропущено, 7 задекларованих відхилень (три нові — від зміни дефолтної моделі та виправлення безпеки). Не перевірено: 429 на четвертій генерації за хвилину, `./scripts/e2e.sh`, P2-8 наживо (потрібен новий коміт у PR), P3-1 наживо (на PR #6 немає рев’ю). |
