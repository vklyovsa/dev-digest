# Домашнє завдання №1 — критерії приймання (чек-лист)

Залік = усі 24 обов'язкових критерії. Колонка «Стан» заповнена після
імплементації: `ok` — виконано і перевірено, `todo` — за користувачем.

Фіча цієї сесії: **лічильники знахідок за severity** («N CRITICAL · N WARNING ·
N SUGGESTION») з фільтром по кліку. Без жодного звернення до LLM.
Спека: [`findings-by-severity.md`](findings-by-severity.md).

## Обов'язкові критерії

| № | Критерій | Стан | Чим підтверджено |
|---|---|---|---|
| 1 | CLAUDE.md — технологічний стек | ok | root `CLAUDE.md` (таблиця пакетів: Fastify 5 + Drizzle, Next 15 + React 19, engine, e2e) + § вступ кожного `*/CLAUDE.md` |
| 2 | CLAUDE.md — структура монорепо | ok | root `CLAUDE.md` таблиця «Folder / Package / What it is / Port» + § Map у кожному пакеті |
| 3 | CLAUDE.md — команди запуску | ok | root § Commands (`./scripts/dev.sh`), `client` `pnpm dev`, `server` `pnpm dev`, `e2e` `./scripts/e2e.sh` |
| 4 | CLAUDE.md — команди перевірки | ok | `client/CLAUDE.md:9`, `server/CLAUDE.md:9-12` (герметична / інтеграційна смуги), `reviewer-core/CLAUDE.md:9` |
| 5 | CLAUDE.md — конвенції найменування | ok | новий розділ: root `CLAUDE.md:58` § Naming conventions + § Naming у всіх чотирьох пакетах |
| 6 | CLAUDE.md — do not touch (міграції) | ok | `server/CLAUDE.md` § Do not touch: застосовані файли `src/db/migrations/` — лише нова міграція |
| 7 | CLAUDE.md — do not touch (lock-файли) | ok | root `CLAUDE.md:80` + § Do not touch кожного пакета (`pnpm-lock.yaml` / `package-lock.json`) |
| 8 | Скіл engineering-insights існує | ok | `.claude/skills/engineering-insights/SKILL.md` (+ `examples.md`, `scripts/append-insight.sh`) |
| 9 | Скіл фіксує знахідки самостійно | ok | протокол у root `CLAUDE.md` § Session protocol; у цій сесії скіл викликано в межах протоколу, без прохання по кожному запису |
| 10 | Записи в INSIGHTS.md потрібного модуля | ok | `client/INSIGHTS.md` (3 записи: popover/clipping, MonoLink, Testing Library), `server/INSIGHTS.md` (severity — free-text колонка; «останнє рев'ю» — лотерея при мультиагентному прогоні), root (session note + open question) |
| 11 | Доказ у записі INSIGHTS.md | ok | у кожному записі `file:line` і дата `(2026-09-17)`; session note — `### 2026-09-17` |
| 12 | Cost у списку Pull Requests | ok | `server/src/modules/pulls/routes.ts` сумує `agent_runs.cost_usd`; вартість пишеться лише на шляху `status:'done'` (`run-executor.ts:249`), провалені — `null`, тому сума = сума успішних. Тест `test/pulls-cost.it.test.ts` (4/4) |
| — | *(поза таблицею)* SCORE + FINDINGS у списку PR | ok | агрегація як у COST — сума по агентах, — але від кожного агента лише його **останній** прогін; dismissed виключені. Приклад із ДЗ (Test Quality 3 + останній прогін General 4 = **7**) закріплений окремим DB-тестом. Score — через `scoreFromFindings` рушія (100 − 35/12/3) з того самого набору, а не з рядка рев'ю. Тести: 11 DB-кейсів у `pulls-findings.it.test.ts` |
| 13 | Cost на вкладці Agent runs | ok | `RunHistory.tsx` → `RunCostBadge variant="detailed"`; тести «RunHistory — run cost» (3/3) |
| 14 | Cost у сайдбарі трасування | ok | `RunTraceDrawer/_components/TraceBody/TraceBody.tsx:67` — `Stat label={t("trace.stat.cost")}` |
| 15 | 5-фазний цикл роботи | ok | Initiation (критерії + питання) → Planning (plan mode + спеки) → Implementation → Validation (типчеки + 5 прогонів тестів) → Completion (INSIGHTS + звіт) |
| 16 | Лічильники findings за severity | ok | `FindingsPanel.tsx` — рядок пілюль у тулбарі картки прогону, під `VerdictBanner` (вердикт + PR SCORE); Timeline-плитки показують severity-іконки свого прогону через `SeverityCounts` без кліку і **без тексту** «N finding(s) · M blockers» |
| 17 | Лічильники відповідають реальності | ok | пілюлі рахуються з `confidentFindings` — того самого списку, що рендериться; тест «a pill count equals the number of cards it leaves behind» |
| 18 | Фільтр знахідок по severity | ok | клік → лише ця severity, повторний клік знімає; тест «clicking the selected pill again clears the filter» |
| 19 | Підрахунок без LLM | ok | `countBySeverity` (клієнт), `summarizeFindings` + `scoreForFindings` (сервер) — групування і арифметика по штрафах; у новому коді немає ні `fetch`, ні виклику моделі |
| 20 | Попап «N FINDINGS IN THIS RUN» на сторінці списку PR | ok | нова колонка FINDINGS у `/repos/:id/pulls` (`PRRow.tsx`), наведення на severity-іконки → `FindingsPopover` із заголовком **«N FINDINGS IN THIS RUN»** дослівно (за рішенням користувача текст лишається таким, хоч набір і охоплює по одному прогону кожного агента). Тести: `PRRow.test.tsx`, `FindingsSummary.test.tsx` |
| 21 | Прев'ю знахідки в попапі — read-only | ok | severity, заголовок, категорія, `file:line`, % confidence, опис; тест «is read-only — no buttons, links or other controls» (0 контролів у попапі) |
| 22 | Картка знахідки з Accept/Reject — інше місце | ok | `FindingCard.tsx` у розгорнутій картці прогону має Accept і Dismiss (назви лишені за рішенням користувача) |
| 23 | Знахідки в сайдбарі Trace and Logs | ok | `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx` — секція Findings поряд зі Stats |
| 24 | docs/ і specs/ по кожному пакету | ok | docs: `client/docs/findings-surfaces.md`, `server/docs/pr-list-read-model.md`, `reviewer-core/docs/severity.md`, `e2e/docs/seeded-fixtures.md`. specs: `client/specs/findings-severity-ui.md`, `server/specs/pr-list-findings-summary.md`, `reviewer-core/specs/severity-source-of-truth.md`, `e2e/specs/*.flow.json` + `findings-severity-filter.spec.md`, root `specs/findings-by-severity.md` + `run-cost*.md`. Усі README-стаби «_Empty for now._» замінені на зміст |

## Додаткові критерії приймання ДЗ

| № | Критерій | Стан |
|---|---|---|
| A | Лічильник знахідок працює | ok — 15 нових клієнтських тестів + 21 серверний (10 герметичних, 11 DB) |
| B | Відкритий PR із гарним описом | todo — опис готовий у `PR_BODY.md`; коміт/пуш/PR за користувачем |
| C | Відео роботи фічі у PR | todo — запис за користувачем (дані: запустити справжнє рев'ю) |
| D | Запис про цю сесію в INSIGHTS.md | ok — root § Session Notes `### 2026-09-17` |
| E | CLAUDE.md разом з INSIGHTS.md, docs, specs | ok — 5 × CLAUDE.md, 5 × INSIGHTS.md, docs і specs у корені та в усіх пакетах |

## Перевірки для приймання ДЗ (повторювані)

| Що перевіряє | Команда | Очікуване |
|---|---|---|
| Лічильники сходяться зі списком знахідок | `node scripts/verify-list-counters.mjs` | `MATCH` на кожному рядку PR; перерахунок іде з **іншого** ендпоінта (`GET /pulls/:id/reviews`) за правилом «останній прогін кожного агента, без dismissed» |
| Нових LLM-викликів немає | `./scripts/verify-no-llm-calls.sh` | `PASS`: `agent_runs` і `run_traces` не змінились, 0 рядків логу зі згадкою провайдера/промпта/токенів |

Останній вивід (2026-09-19): `MATCH` — список `2 findings · 1 CRITICAL ·
1 WARNING · score 53` = перерахунок; `PASS` — `agent_runs=3 → 3`,
`run_traces=3 → 3`, `llm_log_lines=0`.

## Прогони перевірки (2026-09-17)

| Команда | Результат |
|---|---|
| `client: pnpm typecheck` | ok |
| `client: pnpm test` | 57/57 |
| `server: pnpm typecheck` | ok |
| `server: pnpm exec vitest run --exclude '**/*.it.test.ts'` | 111/111 |
| `server: pnpm exec vitest run pulls-findings.it.test` | 11/11 (Testcontainers справді піднявся) |
| `server: pnpm exec vitest run pulls` (усі DB-смуги pulls) | 32/32 |
| `reviewer-core: npm test` | 23/23 |
| `reviewer-core: npm run typecheck` | ok |

Жива перевірка на локальній БД (2026-09-19, стек піднято `./scripts/dev.sh
--no-seed`): PR #1 → `counts: [CRITICAL 1, WARNING 1]`, `score: 53`
(100 − 35 − 12), `cost: $0.0144`. У БД три рев'ю від трьох різних агентів
(Security 100, General 88, Performance 65) — саме той випадок, коли «останнє
рев'ю» показало б лише 1 CRITICAL і score 65.
