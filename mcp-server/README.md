# catalog-server — власний MCP-сервер

Тонкий протокольний адаптер над каталогом з `app/`. Уся доменна логіка
**імпортована** з `app/dist/index.js` — у сервері не перераховується жодне
число.

## SDK

`@modelcontextprotocol/server` **v2.0.0** (нове покоління; імпорти виду
`from "@modelcontextprotocol/server"`). Сигнатури `registerTool` /
`registerResource` звірені з `.d.mts` встановленої версії, а не зі статті.

## Що виставляє

| Тип | Ім'я / URI | Доменна функція | Коли викликається |
|---|---|---|---|
| tool | `search_inventory(query)` | `searchProducts` | пошук за назвою, SKU або категорією (case-insensitive) |
| tool | `check_stock(sku)` | `findBySku` | один товар за точним SKU + порівняння з reorder level |
| tool | `low_stock()` | `lowStock` | усе, що на рівні reorder або нижче, найменший запас першим |
| tool | `inventory_value()` | `inventoryValue` | загальна вартість запасів: `sum(price × stock)` з округленням до копійок |
| resource | `inventory://catalog` | `categories`, `inventoryValue`, `lowStock` | зведення: кількість товарів, категорії, загальна вартість, скільки під reorder |

**tools** — це дії, які викликає модель; **resource** — контекст, який читає
хост за URI. Зведення каталогу свідомо зроблено ресурсом: це «ось стан
складу», а не «піди щось порахуй».

`inventoryValue` присутній в обох: `inventory_value` — це «піди порахуй»,
resource — частина знімка стану. Дублювання свідоме, бо resource модель **не
викликає**. Спершу цього tool не було, і на питання про загальну вартість
запасів модель не мала чим відповісти — деталі в
[../docs/task-e-bonus.md](../docs/task-e-bonus.md).

## Read-only

Жодного запису, видалення чи мережевого виклику. Єдиний доступ до файлової
системи — `loadCatalog()` всередині `app/`, який читає `app/data/catalog.json`
відносно власного модуля (тому cwd хоста не має значення).

Це не лише обіцянка в тексті — кожен tool віддає хосту анотації:

```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

## Збірка і запуск

```bash
cd app && npm install && npm run build && cd ..   # спершу app/dist
cd mcp-server && npm install && npm run build
```

Розкладка навмисна: `src/` і `dist/` на однаковій глибині, тому
`../../app/dist/index.js` коректний і в джерелі, і в збірці (TypeScript **не**
переписує відносні імпорти).

## Перевірка без хоста

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list"}' | node ./dist/server.js
```

Фактичний результат на засіяних даних (24 товари):

- `low_stock()` → **9** позицій, найменша `DK-4001` зі stock 0
- `check_stock("kb-1001")` → `KB-1001`, stock 42 при reorder 15 → запас здоровий
- `inventory://catalog` → `productCount: 24`, `inventoryValue: 46152`,
  `lowStockCount: 9`, 7 категорій

## Реєстрація в хості

У `.mcp.json` в корені репо:

```json
"catalog": {
  "command": "node",
  "args": ["./mcp-server/dist/server.js"]
}
```

Шлях відносний свідомо: `.mcp.json` — це закомічений конфіг рівня проєкту,
абсолютний `K:\...` зламався б у кожного, хто клонує репо. Хост запускає
project-scoped сервери з кореня репо, і решта серверів у цьому файлі вже
покладаються на те саме (`./app`, `./.claude/mcp-memory.json`).

Логи сервера йдуть у **stderr** (`console.error`) — у stdout лише
JSON-RPC, інакше протокол ламається.
