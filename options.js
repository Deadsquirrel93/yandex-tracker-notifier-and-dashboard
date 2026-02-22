// DOM Elements
const elements = {
  oauthToken: document.getElementById('oauthToken'),
  orgId: document.getElementById('orgId'),
  orgType360: document.getElementById('orgType360'),
  orgTypeCloud: document.getElementById('orgTypeCloud'),
  language: document.getElementById('language'),
  interval: document.getElementById('interval'),
  btnLoadStatuses: document.getElementById('btnLoadStatuses'),
  statusesInfo: document.getElementById('statusesInfo'),
  rulesContainer: document.getElementById('rulesContainer'),
  btnAddRule: document.getElementById('btnAddRule'),
  timerRoundingInterval: document.getElementById('timerRoundingInterval'),
  roundMath: document.getElementById('roundMath'),
  roundUp: document.getElementById('roundUp'),
  roundDown: document.getElementById('roundDown'),
  dashboardStatusesContainer: document.getElementById('dashboardStatusesContainer'),
  btnSave: document.getElementById('btnSave'),
  statusMessage: document.getElementById('statusMessage')
};

let cachedStatuses = [];

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.local.get([
    'oauthToken', 'orgId', 'orgType', 'language', 'interval',
    'timerRoundingInterval', 'timerRoundingDirection',
    'cachedStatuses', 'statusesTimestamp', 'rules', 'dashboardStatuses', 'dashboardRoles'
  ]);

  if (data.oauthToken) elements.oauthToken.value = data.oauthToken;
  if (data.orgId) elements.orgId.value = data.orgId;
  if (data.orgType === 'cloud') elements.orgTypeCloud.checked = true;
  else elements.orgType360.checked = true;

  if (data.language) elements.language.value = data.language;
  if (data.interval) elements.interval.value = data.interval;

  if (data.timerRoundingInterval) elements.timerRoundingInterval.value = data.timerRoundingInterval;
  if (data.timerRoundingDirection === 'up') elements.roundUp.checked = true;
  else if (data.timerRoundingDirection === 'down') elements.roundDown.checked = true;
  else elements.roundMath.checked = true;

  if (data.cachedStatuses && data.statusesTimestamp) {
    const ageHours = (Date.now() - data.statusesTimestamp) / (1000 * 60 * 60);
    if (ageHours < 24) {
      cachedStatuses = data.cachedStatuses;
      updateStatusesInfo(new Date(data.statusesTimestamp));
    } else {
      updateStatusesInfo(null, "Кеш устарел");
    }
  } else {
    updateStatusesInfo(null, "Нет кеша");
  }

  if (data.dashboardRoles) {
    document.querySelectorAll('#dashboardRolesContainer input[type="checkbox"]').forEach(cb => {
      cb.checked = data.dashboardRoles.includes(cb.value);
    });
  }

  renderRules(data.rules || []);
  renderDashboardStatuses(data.dashboardStatuses || []);
}

// Update UI
function updateStatusesInfo(date, msg) {
  if (date) {
    elements.statusesInfo.textContent = `Статусы загружены: ${date.toLocaleString()}`;
    elements.btnLoadStatuses.classList.remove('highlight');
  } else {
    elements.statusesInfo.textContent = msg || "Нет кеша статусов";
    elements.btnLoadStatuses.classList.add('highlight');
  }
  renderRules(getRulesFromDOM());
  renderDashboardStatuses(getDashboardStatusesFromDOM());
}

// Fetch statuses from API
async function loadStatuses() {
  const token = elements.oauthToken.value.trim();
  const orgId = elements.orgId.value.trim();
  const orgType = elements.orgTypeCloud.checked ? 'cloud' : '360';
  const language = elements.language.value;

  if (!token || !orgId) {
    showMessage('Введите токен и Org ID для загрузки статусов', 'error');
    return;
  }

  const headers = { 'Authorization': `OAuth ${token}`, 'Accept-Language': language };
  if (orgType === 'cloud') headers['X-Cloud-Org-ID'] = orgId;
  else headers['X-Org-ID'] = orgId;

  try {
    elements.btnLoadStatuses.disabled = true;
    elements.btnLoadStatuses.textContent = 'Загрузка...';

    const response = await fetch('https://api.tracker.yandex.net/v2/statuses', { headers });
    if (!response.ok) throw new Error(`Ошибка API: ${response.status}`);

    const statuses = await response.json();
    cachedStatuses = Array.from(new Set(statuses.map(s => s.display || s.name))).sort((a, b) => a.localeCompare(b));

    const timestamp = Date.now();
    await chrome.storage.local.set({ cachedStatuses, statusesTimestamp: timestamp });

    updateStatusesInfo(new Date(timestamp));
    showMessage('Статусы успешно загружены', 'success');
  } catch (error) {
    showMessage(`Ошибка: ${error.message}`, 'error');
  } finally {
    elements.btnLoadStatuses.disabled = false;
    elements.btnLoadStatuses.textContent = 'Загрузить/Обновить статусы';
  }
}

// Render dynamic rules
function renderRules(rules) {
  elements.rulesContainer.innerHTML = '';
  rules.forEach(rule => addRuleToDOM(rule));
}

function addRuleToDOM(rule = { role: 'Assignee', status: '' }) {
  const div = document.createElement('div');
  div.className = 'rule-item';

  const roleSelect = document.createElement('select');
  roleSelect.className = 'role-select';
  const rolesMap = { 'Assignee': 'Исполнитель', 'Author': 'Автор', 'Followers': 'Наблюдатель' };
  Object.keys(rolesMap).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = rolesMap[r];
    if (r === rule.role) opt.selected = true;
    roleSelect.appendChild(opt);
  });

  const statusSelect = document.createElement('select');
  statusSelect.className = 'status-select';
  if (cachedStatuses.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Нет закешированных статусов';
    statusSelect.appendChild(opt);
  } else {
    cachedStatuses.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      if (s === rule.status) opt.selected = true;
      statusSelect.appendChild(opt);
    });
  }

  const btnRemove = document.createElement('button');
  btnRemove.textContent = 'Удалить';
  btnRemove.onclick = () => div.remove();

  div.appendChild(roleSelect);
  div.appendChild(statusSelect);
  div.appendChild(btnRemove);

  elements.rulesContainer.appendChild(div);
}

function renderDashboardStatuses(selectedStatuses) {
  elements.dashboardStatusesContainer.innerHTML = '';
  if (cachedStatuses.length === 0) {
    elements.dashboardStatusesContainer.textContent = 'Сначала загрузите статусы.';
    return;
  }

  cachedStatuses.forEach(status => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = status;
    checkbox.checked = selectedStatuses.includes(status);

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(status));
    elements.dashboardStatusesContainer.appendChild(label);
  });
}

function getRulesFromDOM() {
  const rules = [];
  document.querySelectorAll('.rule-item').forEach(div => {
    const role = div.querySelector('.role-select').value;
    const status = div.querySelector('.status-select').value;
    if (status && status !== 'Нет закешированных статусов') rules.push({ role, status });
  });
  return rules;
}

function getDashboardStatusesFromDOM() {
  const statuses = [];
  document.querySelectorAll('#dashboardStatusesContainer input:checked').forEach(cb => {
    statuses.push(cb.value);
  });
  return statuses;
}

function getDashboardRolesFromDOM() {
  const roles = [];
  document.querySelectorAll('#dashboardRolesContainer input:checked').forEach(cb => {
    roles.push(cb.value);
  });
  return roles;
}

async function saveSettings() {
  const oauthToken = elements.oauthToken.value.trim();
  const orgId = elements.orgId.value.trim();
  const orgType = elements.orgTypeCloud.checked ? 'cloud' : '360';
  const language = elements.language.value;
  const interval = parseInt(elements.interval.value, 10);

  const rules = getRulesFromDOM();
  const dashboardStatuses = getDashboardStatusesFromDOM();
  const dashboardRoles = getDashboardRolesFromDOM();

  const timerRoundingInterval = elements.timerRoundingInterval.value;
  let timerRoundingDirection = 'math';
  if (elements.roundUp.checked) timerRoundingDirection = 'up';
  if (elements.roundDown.checked) timerRoundingDirection = 'down';

  await chrome.storage.local.set({
    oauthToken, orgId, orgType, language, interval,
    rules, dashboardStatuses, dashboardRoles,
    timerRoundingInterval, timerRoundingDirection
  });

  await chrome.storage.local.remove('notified_issues'); // Сбрасываем кеш уведомлений при смене правил
  chrome.alarms.create('trackerCheck', { periodInMinutes: interval });

  chrome.runtime.sendMessage({ action: 'checkTrackerSilent' }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Silent check deferred - background worker sleeping.");
    }
  });

  showMessage('Настройки сохранены!', 'success');
}

function showMessage(msg, type) {
  elements.statusMessage.textContent = msg;
  elements.statusMessage.className = `status-message ${type}`;
  setTimeout(() => {
    elements.statusMessage.textContent = '';
    elements.statusMessage.className = 'status-message';
  }, 3000);
}

elements.btnLoadStatuses.addEventListener('click', loadStatuses);
elements.btnAddRule.addEventListener('click', () => addRuleToDOM());
elements.btnSave.addEventListener('click', saveSettings);
document.addEventListener('DOMContentLoaded', loadSettings);
