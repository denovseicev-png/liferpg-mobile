const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Функция ' + name + ' должна существовать');
  const open = html.indexOf('{', start);
  assert.notEqual(open, -1, 'Тело функции ' + name + ' найдено');
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  assert.fail('Функция ' + name + ' не закрыта');
}

function loadFocusFunctions(context) {
  const names = ['normalizeFocusModes', 'focusBlocksToAward', 'focusAwardDueBlocks', 'focusDuration', 'focusTick', 'focusStartPause', 'focusReset', 'focusSwitchMode', 'saveFocusSettings', 'defaults', 'normalize'];
  vm.runInNewContext(names.map(functionSource).join('\n'), context);
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
    VERSION: 3,
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
    save: () => true,
    render: () => {},
    clearInterval: () => {},
    setInterval: () => 1,
    confirm: () => true,
    focusInterval: null,
    updateFocusTimerUI: () => {},
    updateFocusHomeSummary: () => {}
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

test('меню Все содержит все 13 разделов в правильном порядке', () => {
  const overlay = html.match(/id="section-menu-overlay"[\s\S]*?id="toast"/);
  assert.ok(overlay, 'оверлей меню найден');
  const pages = [...overlay[0].matchAll(/data-menu-page="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(pages, [
    'home', 'search', 'quests', 'habits', 'goals', 'study',
    'focus', 'bank', 'insights', 'calendar', 'notes', 'skills', 'settings'
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

  assert.deepEqual(JSON.parse(JSON.stringify(modes.map(x => [x.name, x.focusMinutes, x.restMinutes]))), [
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

test('фокус вынесен в отдельный экран и удалён с главной страницы', () => {
  const home = html.match(/<div id="page-home"[\s\S]*?<div id="page-quests"/);
  assert.ok(home, 'главная страница найдена');
  assert.doesNotMatch(home[0], /id="timer"/);
  assert.match(home[0], /data-open="focus"/);
  assert.match(html, /<div id="page-focus" class="page">/);
  assert.match(html, /data-menu-page="focus"/);
});

test('экран фокуса позволяет настроить три профиля и атрибут награды', () => {
  for (const id of [
    'focus-name-short', 'focus-minutes-short', 'rest-minutes-short',
    'focus-name-deep', 'focus-minutes-deep', 'rest-minutes-deep',
    'focus-name-long', 'focus-minutes-long', 'rest-minutes-long',
    'focus-reward-xp', 'focus-reward-attribute', 'save-focus-settings'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /<option value="Разум">Разум<\/option>/);
});

test('конец фокус-фазы выдаёт блок XP и переводит таймер на отдых без автозапуска', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusModes = [
    { id: 'short', name: 'Короткий', focusMinutes: 25, restMinutes: 5 }
  ];
  c.state.focusSettings = { rewardXP: 4, rewardAttribute: 'Разум' };
  c.state.focusTimer = {
    sessionId: 'phase-1', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 1, elapsedFocusSeconds: 599,
    rewardedBlocks: 0, running: true
  };

  c.focusTick();

  assert.equal(c.state.focusTimer.running, false);
  assert.equal(c.state.focusTimer.phase, 'rest');
  assert.equal(c.state.focusTimer.remainingSeconds, 300);
  assert.equal(c.state.focusTimer.elapsedFocusSeconds, 600);
  assert.equal(c.state.xp, 4);
  assert.equal(c.state.journal[0].extra, 'Разум');
});

test('окончание отдыха возвращает фокус, но не начисляет XP за отдых', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusModes = [
    { id: 'short', name: 'Короткий', focusMinutes: 25, restMinutes: 5 }
  ];
  c.state.focusSettings = { rewardXP: 4, rewardAttribute: 'Разум' };
  c.state.focusTimer = {
    sessionId: 'phase-2', selectedMode: 'short', phase: 'rest',
    remainingSeconds: 1, elapsedFocusSeconds: 600,
    rewardedBlocks: 1, running: true
  };

  c.focusTick();

  assert.equal(c.state.focusTimer.running, false);
  assert.equal(c.state.focusTimer.phase, 'focus');
  assert.equal(c.state.focusTimer.remainingSeconds, 1500);
  assert.equal(c.state.xp, 0);
});

test('пауза и продолжение не сбрасывают неполный блок и не выдают повторный XP', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusTimer = {
    sessionId: 'pause-1', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 400, elapsedFocusSeconds: 900,
    rewardedBlocks: 1, running: true
  };
  c.state.focusSettings = { rewardXP: 5, rewardAttribute: 'Разум' };

  c.focusStartPause();
  assert.equal(c.state.focusTimer.running, false);
  assert.equal(c.state.focusTimer.elapsedFocusSeconds, 900);
  c.focusStartPause();
  assert.equal(c.state.focusTimer.running, true);
  assert.equal(c.focusAwardDueBlocks(), 0);
  assert.equal(c.state.journal.length, 0);
});

test('сброс сессии не отменяет уже начисленный XP', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusModes = [
    { id: 'short', name: 'Короткий', focusMinutes: 25, restMinutes: 5 }
  ];
  c.state.focusTimer = {
    sessionId: 'reset-1', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 100, elapsedFocusSeconds: 900,
    rewardedBlocks: 1, running: false
  };
  c.state.xp = 5;
  c.state.total = 5;
  c.state.journal.push({
    id: 'already-earned', date: '2026-10-29',
    title: 'Фокус · 10 минут', type: 'focus', xp: 5, extra: 'Разум'
  });

  c.focusReset();

  assert.equal(c.state.focusTimer.elapsedFocusSeconds, 0);
  assert.equal(c.state.focusTimer.rewardedBlocks, 0);
  assert.equal(c.state.focusTimer.phase, 'focus');
  assert.equal(c.state.xp, 5);
  assert.equal(c.state.total, 5);
  assert.equal(c.state.journal.length, 1);
});

test('смена режима на паузе сохраняет накопленные фокус-секунды и выданные блоки', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusModes = [
    { id: 'short', name: 'Короткий', focusMinutes: 25, restMinutes: 5 },
    { id: 'deep', name: 'Глубокий', focusMinutes: 50, restMinutes: 10 },
    { id: 'long', name: 'Длинный', focusMinutes: 90, restMinutes: 15 }
  ];
  c.state.focusTimer = {
    sessionId: 'switch-1', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 400, elapsedFocusSeconds: 900,
    rewardedBlocks: 1, running: false
  };
  c.renderFocus = () => {};
  c.updateFocusHomeSummary = () => {};

  c.focusSwitchMode('deep');

  assert.equal(c.state.focusTimer.selectedMode, 'deep');
  assert.equal(c.state.focusTimer.phase, 'focus');
  assert.equal(c.state.focusTimer.remainingSeconds, 3000);
  assert.equal(c.state.focusTimer.elapsedFocusSeconds, 900);
  assert.equal(c.state.focusTimer.rewardedBlocks, 1);
});

test('сохранение фокуса применяет длительности всех режимов, XP и атрибут', () => {
  const c = loadFocusFunctions(makeContext());
  const fields = {
    'focus-name-short': { value: 'Спринт' },
    'focus-minutes-short': { value: '18' },
    'rest-minutes-short': { value: '4' },
    'focus-name-deep': { value: 'Учёба' },
    'focus-minutes-deep': { value: '55' },
    'rest-minutes-deep': { value: '12' },
    'focus-name-long': { value: 'Большая задача' },
    'focus-minutes-long': { value: '100' },
    'rest-minutes-long': { value: '20' },
    'focus-reward-xp': { value: '8' },
    'focus-reward-attribute': { value: 'Разум' }
  };
  c.$ = id => fields[id] || { value: '' };
  c.renderFocus = () => {};
  c.updateFocusHomeSummary = () => {};
  c.toast = () => {};
  c.state.settings = { focus: 25 };
  c.state.focusModes = c.normalizeFocusModes(null, 25);
  c.state.focusSettings = { rewardXP: 5, rewardAttribute: 'Общее' };
  c.state.focusTimer = {
    sessionId: 'settings-1', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 1500, elapsedFocusSeconds: 0,
    rewardedBlocks: 0, running: false
  };

  c.saveFocusSettings();

  assert.deepEqual(JSON.parse(JSON.stringify(c.state.focusModes.map(x => [
    x.name, x.focusMinutes, x.restMinutes
  ]))), [
    ['Спринт', 18, 4],
    ['Учёба', 55, 12],
    ['Большая задача', 100, 20]
  ]);
  assert.equal(c.state.focusSettings.rewardXP, 8);
  assert.equal(c.state.focusSettings.rewardAttribute, 'Разум');
  assert.equal(c.state.focusTimer.remainingSeconds, 1080);
});

test('нельзя менять профиль во время активного таймера', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusModes = c.normalizeFocusModes(null, 25);
  c.state.focusTimer = {
    sessionId: 'switch-running', selectedMode: 'short', phase: 'focus',
    remainingSeconds: 900, elapsedFocusSeconds: 300,
    rewardedBlocks: 0, running: true
  };
  c.renderFocus = () => {};
  c.updateFocusHomeSummary = () => {};
  c.toast = () => {};

  c.focusSwitchMode('long');

  assert.equal(c.state.focusTimer.selectedMode, 'short');
  assert.equal(c.state.focusTimer.remainingSeconds, 900);
  assert.equal(c.state.focusTimer.running, true);
});

test('источник уже начисленного блока не позволяет повторно выдать тот же XP', () => {
  const c = loadFocusFunctions(makeContext());
  c.state.focusTimer = {
    sessionId: 'duplicate-1', elapsedFocusSeconds: 600, rewardedBlocks: 0
  };
  c.state.focusSettings = { rewardXP: 5, rewardAttribute: 'Разум' };
  c.state.journal.push({
    id: 'already-rewarded', date: '2026-10-29',
    title: 'Фокус · 10 минут', type: 'focus', xp: 5,
    extra: 'Разум', sourceId: 'focus-duplicate-1-1'
  });

  assert.equal(c.focusAwardDueBlocks(), 1);
  assert.equal(c.state.journal.length, 1);
  assert.equal(c.state.pendingBonuses.length, 0);
  assert.equal(c.state.focusTimer.rewardedBlocks, 1);
});

test('миграция переносит оставшееся время старого фокуса и отдыха', () => {
  const c = loadFocusFunctions(makeContext());
  const focusState = c.normalize({
    settings: { focus: 40 },
    timer: { mode: 'break', seconds: 125 }
  });

  assert.equal(focusState.focusModes[0].focusMinutes, 40);
  assert.equal(focusState.focusTimer.phase, 'rest');
  assert.equal(focusState.focusTimer.remainingSeconds, 125);
  assert.equal(focusState.focusTimer.running, false);
});
