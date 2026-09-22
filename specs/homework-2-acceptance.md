# Домашнє завдання №2 — критерії приймання (чек-лист)

Фіча: **скіли для рев'ю-агентів** — зберігання, редактор, прив'язка до агента,
імпорт. Спека: [`skills.md`](skills.md). Контрольний експеримент:
[`skills-control-experiment.md`](skills-control-experiment.md).

`ok` — виконано і перевірено статично; `todo` — лишається за користувачем
(запуск тестів, справжній прогін моделі, запис відео, відкриття PR).

## Вимоги до фічі

| № | Критерій | Стан | Чим підтверджено |
|---|---|---|---|
| 1 | Серверний модуль із CRUD над таблицею скілів; БД — джерело правди | ok | `server/src/modules/skills/` (routes/service/repository/helpers/extract/archive/community/constants); 12 роутів, усі workspace-scoped через `getContext` |
| 2 | Сторінка Skills: картки з назвою, типом, описом і перемикачем | ok | `client/src/app/skills/_components/SkillCard/` + `SkillsList/`; тип і джерело — чипи, перемикач — `skills.enabled` |
| 3 | Клік по картці відкриває прев'ю збоку | ok | `SkillsView` — дві панелі, вибір у `?skill=`; вкладка Preview рендерить тіло через `<Markdown>` |
| 4 | Кнопка «додати» з вибором «створити / імпортувати» | ok | `SkillsList` → `Dropdown`: «Create from scratch», «Import from file or archive», «Search community skills…» |
| 5 | Редактор: назва, опис, тип, тіло в markdown | ok | `SkillDetail/_components/ConfigTab/` + `MarkdownEditor/` (гутер, «unsaved», `≈N tokens`) |
| 6 | Опис — інтерфейс скіла, формулюємо директивно; на UI є підказка | ok | `config.descriptionHint` у `messages/en/skills.json`; той самий підпис у модалці створення; тест «tells the author that the description is the skill's interface» |
| 7 | Вкладка Skills у редакторі агента: прив'язка, увімкнення/вимкнення, порядок | ok | `AgentEditor/_components/SkillsTab/` — чекбокси, drag-and-drop + кнопки ↑/↓, позиція `#N` біля кожного прив'язаного |
| 8 | Порядок визначає послідовність блоків у промпті | ok | `agent_skills.order` → `SkillsRepository.linkedEnabled` (ORDER BY) → `renderSkillBlocks` → `assemblePrompt`; DB-тест «linked enabled skills become labelled blocks, in the order the agent sets» |
| 9 | Імпорт markdown-файлу або архіву | ok | `POST /skills/import/preview` приймає `{filename, content_base64}`; `.md` і `.zip` (власний ZIP-ридер на `node:zlib`) |
| 10 | Продукт дістає ядро скіла й показує прев'ю | ok | `extract.ts` — frontmatter + вибір ядра за рангом (`SKILL.md` → `readme.md` → найменша глибина); `ImportPreview` показує текст, `files_used`, `files_skipped` |
| 11 | Збереження лише після підтвердження | ok | два роути: `/import/preview` **нічого не пише**, `/import` пише; DB-тест «previewing an archive persists NOTHING» рахує рядки до і після |
| 12 | Виконувані частини архіву не обробляються | ok | `classifyEntry` → `executable` за розширенням і за каталогом (`scripts/`, `bin/`, `hooks/`, `.github/`); розпаковується **тільки** переможець-markdown; тест перевіряє, що вміст `install.sh` не потрапив у прев'ю |
| 13 | Новий агент Test Quality Reviewer | ok | `seed-prompts.ts` + `docs/agent-prompts/test-quality-reviewer.md`; непокриті гілки, corner cases, надмірне мокування, флейки |
| 14 | Кожному агенту прив'язані його скіли | ok | сид: Test Quality → 3 скіли; General → `pr-quality-rubric` + `api-contract-gate`; Security → `secret-leakage-gate` + rubric; Performance → rubric |
| 15 | Принаймні один скіл заводиться через імпорт | ok (шлях готовий) / todo (дія на демо) | фікстура `specs/fixtures/flaky-test-heuristics/` (SKILL.md + `scripts/install.sh`) і запис у вбудованому каталозі; четвертий скіл Test Quality Reviewer навмисно **не** засіяний |

## Перевірка наприкінці (ваш список)

| Критерій | Стан | Чим підтверджено |
|---|---|---|
| `pr-self-review` існує з вимкненим автовикликом | ok | `.claude/skills/pr-self-review/` + `PreToolUse`-хук у `.claude/settings.json`; сам по собі не запускається — лише на `/pr-self-review` або коли хук відмовляє `gh pr create` |
| Викликали вручну й бачили, що він підтягнув і фронтові, і бекендні скіли | ok | прогін цієї сесії: 217 файлів → 11 лейнів; бекенд — `onion-architecture` (45), `drizzle-orm-patterns` (7), `fastify-best-practices` (6), `postgresql-table-design` (3), `zod` (8); фронт — `frontend-ui-architecture` (79), `react-best-practices` (35), `react-testing-library` (8), `next-best-practices` (6). Вердикт: `.claude/pr-self-review/last-run.md` |
| Скіл створюється й редагується в UI | ok | `CreateSkillModal` → `POST /skills`; `ConfigTab` → `PUT /skills/:id`; зміна тіла піднімає версію і пише знімок |
| Обидва нові агенти мають прив'язані скіли | ok (з поправкою) | за вашим уточненням новий агент один — Test Quality Reviewer (3 прив'язані скіли). Другий бік експерименту веде наявний General Reviewer із прив'язаним `api-contract-gate` |
| Увімкнений скіл видно в логах окремим блоком, вимкнений — ні | ok | `run-executor` пише `Skills in prompt (N): …` або «No enabled skills linked…»; у трасі — блок `Skills (dynamic)` з `≈N tok`. DB-тести: `prompt_assembly.skills === null` без скілів; вимкнений скіл у промпт не потрапляє |
| Імпорт пройшов через прев'ю, виконуване не запускалось | ok | див. рядки 11–12 вище; `archive.ts` нічого не пише на диск і не виконує — це чистий читач буфера |
| Контрольний експеримент відтворюється на обох агентах | ok (процедура) / todo (прогін) | [`skills-control-experiment.md`](skills-control-experiment.md): фікстури дифів, покрокові прогони A/B для Test Quality і для API-contract, критерії успіху й чому результат може не відтворитись |

## Що лишається за користувачем

| Дія | Команда / крок |
|---|---|
| Застосувати міграції | `cd server && pnpm db:migrate` (нові `0011`, `0012`) |
| Засіяти агентів і скіли | `cd server && pnpm db:seed` (ідемпотентно) |
| Прогнати тести | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · `pnpm exec vitest run .it.test` · `cd client && pnpm test` |
| Контрольний експеримент | за [`skills-control-experiment.md`](skills-control-experiment.md) — потрібен ключ провайдера і PR у репозиторії |
| Відео + PR | текст опису — `PR_BODY-skills.md`, сценарій — `DEMO_SCRIPT-skills.md` |

## Постійні гарантії проти разових перевірок

Разових скриптів у репозиторії навмисно немає — постійну гарантію дають тести:

| Твердження | Тест |
|---|---|
| Прев'ю імпорту нічого не зберігає | `server/test/skills.it.test.ts` — «previewing an archive persists NOTHING…» |
| Виконуване з архіву не потрапляє нікуди | `server/test/skills-extract.test.ts` — «takes the skill core out of an archive and skips the executables» |
| Скіли в промпті = прив'язані ∩ увімкнені, у порядку | `server/test/reviews-skills.it.test.ts` (4 кейси) |
| Версія пінить текст, restore не переписує історію | `server/test/skills.it.test.ts` (3 кейси) |
| Вкладка агента не може знести прив'язки | `client/…/SkillsTab.test.tsx` — «renders nothing clickable until the agent's links have loaded» |
