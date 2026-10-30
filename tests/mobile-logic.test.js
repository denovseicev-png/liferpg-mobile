const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Функция ' + name + ' должна существовать');
  const end = html.indexOf('\nfunction ', start + 1);
  return html.slice(start, end === -1 ? html.indexOf('</script>', start) : end);
}

function loadFocusFunctions(context) {
  const names = ['normalizeFocusModes', 'focusBlocksToAward', 'focusAwardDueBlocks'];
  vm.runInNewContext(names.map(functionSource).join('\\n'), context);
  return context;
}

function makeContext() {
  let id = 0;
  const today = '2026-10-29';
  const state = {
    xp: 0, total: 0, coins: 0,
    settings: { cap: 0, dailyLimit: 800, weeklyLimit: 6000 },
    journal: [], bankHistory: [], achievements: [],
    quests: [], habits: [], goals: [], reviews: [], pendingBonuses: []
  };
  const context = {
    state,
    today: () => today,
    uid: () => 'test-' + (++id),
    num: (value, min, max, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    },
    xpToday: () => state.journal.filter(x => x.date === today)
      .reduce((sum, x) => sum + Math.max(0, Number(x.xp) || 0), 0),
    xpWeek: () => state.journal.filter(x => x.date >= '2026-10-26')
      .reduce((sum, x) => sum + Math.max(0, Number(x.xp) || 0), 0),
    checkAchievements: () => {},
    toast: () => {},
    save: () => {},
    render: () => {}
  };
  const names = [
    'journal', 'giveXP', 'awardCoins', 'undoXP', 'removeCoins', 'toggle'
  ];
  vm.runInNewContext(names.map(functionSource).join('\n'), context);
  return context;
}

test('отмена квеста с таким же названием не отменяет награду другого квеста', () => {
  const c = makeContext();
  const first = {
    id: 'quest-1', title: 'Одинаковое название', xp: 10,
    due: '2026-10-29', period: 'once', doneDate: ''
  };
  const second = {
    id: 'quest-2', title: 'Одинаковое название', xp: 20,
    due: '2026-10-29', period: 'once', doneDate: ''
  };
  c.state.quests.push(first, second);

  c.toggle('quest', first.id);
  c.toggle('quest', second.id);
  c.toggle('quest', first.id);

  assert.equal(c.state.xp, 20);
  assert.equal(c.state.total, 20);
  assert.equal(c.state.coins, 2);
  assert.equal(c.state.journal.filter(x => x.xp > 0).length, 1);
  assert.equal(c.state.journal.find(x => x.xp > 0).sourceId, second.id);
});

test('отмена повторяющегося квеста восстанавливает исходную дату', () => {
  const c = makeContext();
  const quest = {
    id: 'recurring-1', title: 'Повтор', xp: 10,
    due: '2026-10-20', period: 'daily', doneDate: ''
  };
  c.state.quests.push(quest);

  c.toggle('quest', quest.id);
  assert.equal(quest.due, '2026-10-30');
  c.toggle('quest', quest.id);

  assert.equal(quest.due, '2026-10-20');
  assert.equal(quest.doneDate, '');
  assert.equal(c.state.xp, 0);
  assert.equal(c.state.coins, 0);
});

test('отмена привычки с одинаковым названием не списывает чужую награду', () => {
  const c = makeContext();
  const first = { id: 'habit-1', title: 'Привычка', xp: 5, checks: [] };
  const second = { id: 'habit-2', title: 'Привычка', xp: 7, checks: [] };
  c.state.habits.push(first, second);

  c.toggle('habit', first.id);
  c.toggle('habit', second.id);
  c.toggle('habit', first.id);

  assert.equal(c.state.xp, 7);
  assert.equal(c.state.total, 7);
  assert.equal(c.state.coins, 1);
  assert.equal(c.state.journal.filter(x => x.xp > 0).length, 1);
  assert.equal(c.state.journal.find(x => x.xp > 0).sourceId, second.id);
});

test('начисление XP не проходит сверх дневного лимита', () => {
  const c = makeContext();
  c.state.settings.dailyLimit = 10;
  assert.equal(c.giveXP(10, 'Первое', 'quest'), true);
  assert.equal(c.giveXP(1, 'Сверх лимита', 'quest'), false);
  assert.equal(c.state.xp, 10);
  assert.equal(c.state.journal.filter(x => x.xp > 0).length, 1);
});

test('импорт не сообщает об успехе, если резервная копия не сохранилась', () => {
  assert.match(
    html,
    /const previous=state;state=normalize\(parsed\);if\(!save\(\)\)\{state=previous;render\(\);return\}/
  );
});

test('квесты доступны напрямую из настроек и список не скрывает старые записи по умолчанию', () => {
  assert.match(html, /id="open-quests"/);
  assert.match(html, /<option value="all" selected>Все квесты<\/option>/);
});

test('при переходе к экрану отмечается соответствующий пункт меню', () => {
  assert.match(html, /querySelectorAll\('\[data-menu-page\]'\)/);
  assert.match(html, /b\.dataset\.menuPage===page/);
});

test('нижняя панель содержит только кнопку Все', () => {
  const nav = html.match(/<nav class="nav"[^>]*>[\s\S]*?<\/nav>/);
  assert.ok(nav, 'нижняя панель найдена');
  const buttons = [...nav[0].matchAll(/<button\b/g)];
  assert.equal(buttons.length, 1);
  assert.match(nav[0], /id="open-section-menu"/);
  assert.match(nav[0], /Все/);
});

test('панель меню имеет размытый затемнённый фон', () => {
  const css = html.match(/\.section-menu-overlay\{[^}]+\}/);
  assert.ok(css, 'CSS фона меню найден');
  assert.match(css[0], /backdrop-filter:\s*blur\(/);
  assert.match(css[0], /background:/);
});

test('меню Все содержит все 12 разделов в правильном порядке', () => {
  const overlay = html.match(/id="section-menu-overlay"[\s\S]*?id="toast"/);
  assert.ok(overlay, 'оверлей меню найден');
  const pages = [...overlay[0].matchAll(/data-menu-page="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(pages, [
    'home', 'search', 'quests', 'habits', 'goals', 'study',
    'bank', 'insights', 'calendar', 'notes', 'skills', 'settings'
  ]);
  assert.match(overlay[0], /role="dialog"/);
});

test('меню поддерживает открытие, закрытие, выбор и системную кнопку назад', () => {
  assert.match(html, /function openSectionMenu\(/);
  assert.match(html, /function closeSectionMenu\(/);
  assert.match(html, /data-menu-page/);
  assert.match(html, /addEventListener\('keydown'/);
  assert.match(html, /addEventListener\('popstate'/);
});

test('три режима сохраняют настройки и мигрируют старую длительность фокуса', () => {
  const c = loadFocusFunctions(makeContext());
  const modes = c.normalizeFocusModes([
    { id: 'one', name: 'Спринт', focusMinutes: 15, restMinutes: 3 },
    { id: 'two', name: 'Погружение', focusMinutes: 45, restMinutes: 9 }
  ], 30);

  assert.deepEqual(modes.map(x => [x.name, x.focusMinutes, x.restMinutes]), [
    ['Спринт', 15, 3],
    ['Погружение', 45, 9],
    ['Длинный', 90, 15]
  ]);
  assert.equal(c.normalizeFocusModes(null, 35)[0].focusMinutes, 35);
});

test('награда доступна только за каждый полный блок в 600 секунд', () => {
  assert.equal(loadFocusFunctions(makeContext()).focusBlocksToAward(599, 0), 0);
  const c = loadFocusFunctions(makeContext());
  assert.equal(c.focusBlocksToAward(600, 0), 1);
  assert.equal(c.focusBlocksToAward(1200, 0), 2);
  assert.equal(c.focusBlocksToAward(1200, 2), 0);
  assert.equal(c.focusBlocksToAward(1799, 1), 1);
});

test('каждый десятиминутный блок начисляется один раз выбранному атрибуту', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusTimer = {
    sessionId: 'session-1', elapsedFocusSeconds: 1200, rewardedBlocks: 0
  };
  c.state.focusSettings = { rewardXP: 5, rewardAttribute: 'Разум' };

  assert.equal(c.focusAwardDueBlocks(), 2);
  assert.equal(c.state.xp, 10);
  assert.equal(c.state.journal.length, 2);
  assert.deepEqual(c.state.journal.map(x => x.extra), ['Разум', 'Разум']);
  assert.equal(c.focusAwardDueBlocks(), 0);
  assert.equal(c.state.journal.length, 2);
});

test('блок фокуса при исчерпанном лимите сохраняется как бонус с исходным атрибутом', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.settings.dailyLimit = 5;
  c.state.focusTimer = {
    sessionId: 'session-2', elapsedFocusSeconds: 1200, rewardedBlocks: 0
  };
  c.state.focusSettings = { rewardXP: 5, rewardAttribute: 'Разум' };

  assert.equal(c.focusAwardDueBlocks(), 2);
  assert.equal(c.state.xp, 5);
  assert.equal(c.state.pendingBonuses.length, 1);
  assert.equal(c.state.pendingBonuses[0].xp, 5);
  assert.equal(c.state.pendingBonuses[0].attribute, 'Разум');
  assert.equal(c.focusAwardDueBlocks(), 0);
  assert.equal(c.state.pendingBonuses.length, 1);
});
