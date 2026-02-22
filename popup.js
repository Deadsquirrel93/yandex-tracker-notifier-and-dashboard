const spinner = document.getElementById('spinner');
const content = document.getElementById('content');
const errorMsg = document.getElementById('error');

// Timer Elements
const timerTask = document.getElementById('timerTask');
const timerMinutes = document.getElementById('timerMinutes');
const btnTimerStart = document.getElementById('btnTimerStart');
const btnTimerPause = document.getElementById('btnTimerPause');
const btnTimerStop = document.getElementById('btnTimerStop');
const btnTimerReset = document.getElementById('btnTimerReset');
const timerStatus = document.getElementById('timerStatus');
const timerSpentInfo = document.getElementById('timerSpentInfo');

let timerIntervalName = 'dashboardTimer';
let uiInterval = null;

function renderTimerUI(state) {
    if (state.isRunning) {
        btnTimerStart.style.display = 'none';
        btnTimerPause.style.display = 'flex';
        timerMinutes.disabled = true;
        timerTask.disabled = true;
    } else {
        btnTimerStart.style.display = 'flex';
        btnTimerPause.style.display = 'none';
        timerMinutes.disabled = false;
        timerTask.disabled = false;
    }
    timerTask.value = state.taskKey || '';
    // Calculate current accumulated + elapsed + previously spent
    let sessionMins = state.accumulatedMinutes || 0;
    if (state.isRunning && state.startTime) {
        sessionMins += Math.floor((Date.now() - state.startTime) / 60000);
    }

    let previousMins = state.previouslySpentMinutes || 0;
    let totalMins = previousMins + sessionMins;

    // Only update if not typing manually
    if (document.activeElement !== timerMinutes) {
        timerMinutes.value = totalMins;
    }

    if (previousMins > 0) {
        timerSpentInfo.textContent = `Вкл. ${previousMins}м из трекера`;
        timerSpentInfo.style.display = 'inline';
    } else {
        timerSpentInfo.style.display = 'none';
    }
}
async function startTimerUIUpdate() {
    if (uiInterval) clearInterval(uiInterval);
    uiInterval = setInterval(async () => {
        const { timerState } = await chrome.storage.local.get(['timerState']);
        if (timerState && timerState.isRunning) renderTimerUI(timerState);
    }, 10000); // 10 sec update
}

async function handleTimerStart() {
    const rawTask = timerTask.value.trim();
    if (!rawTask) {
        showTimerStatus("Укажите задачу", "error");
        return;
    }

    const taskKey = extractTaskKey(rawTask);

    // Check if we already have a state for this task
    const { timerState } = await chrome.storage.local.get(['timerState']);
    let previousMins = 0;
    let manualSessionMins = 0;

    if (timerState && timerState.taskKey === taskKey && !timerState.isRunning) {
        previousMins = timerState.previouslySpentMinutes || 0;
        let displayedTotal = parseInt(timerMinutes.value, 10);
        if (isNaN(displayedTotal) || displayedTotal < 0) displayedTotal = 0;
        manualSessionMins = Math.max(0, displayedTotal - previousMins);
    } else {
        // First start for this task, force fetch from tracker
        previousMins = await fetchSpentTime(taskKey);
        let displayedTotal = parseInt(timerMinutes.value, 10);
        if (isNaN(displayedTotal) || displayedTotal < 0) displayedTotal = 0;
        manualSessionMins = Math.max(0, displayedTotal - previousMins);
    }

    const state = {
        isRunning: true,
        taskKey: taskKey,
        startTime: Date.now(),
        accumulatedMinutes: manualSessionMins,
        previouslySpentMinutes: previousMins
    };

    await chrome.storage.local.set({ timerState: state });
    renderTimerUI(state);
    startTimerUIUpdate();
}

async function handleTimerPause() {
    const { timerState } = await chrome.storage.local.get(['timerState']);
    if (timerState && timerState.isRunning) {
        const elapsed = Math.floor((Date.now() - timerState.startTime) / 60000);
        timerState.accumulatedMinutes += elapsed;
        timerState.isRunning = false;
        timerState.startTime = null;
        await chrome.storage.local.set({ timerState });
        renderTimerUI(timerState);
        if (uiInterval) clearInterval(uiInterval);
    }
}

async function handleTimerReset() {
    await chrome.storage.local.set({ timerState: { isRunning: false, taskKey: '', startTime: null, accumulatedMinutes: 0, previouslySpentMinutes: 0 } });
    renderTimerUI({ isRunning: false, taskKey: '', startTime: null, accumulatedMinutes: 0, previouslySpentMinutes: 0 });
    if (uiInterval) clearInterval(uiInterval);
}

function roundMinutes(minutes, step, direction) {
    if (step <= 1) return minutes;

    const remainder = minutes % step;
    if (remainder === 0) return minutes;

    if (direction === 'up') return minutes + (step - remainder);
    if (direction === 'down') return minutes - remainder;

    // Math (nearest)
    if (remainder >= step / 2) return minutes + (step - remainder);
    return minutes - remainder;
}

function formatDuration(minutes) {
    if (minutes <= 0) return 'PT0S';
    let pDur = 'PT';
    const d = Math.floor(minutes / (24 * 60));
    minutes -= d * 24 * 60;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    if (d > 0) pDur += d + 'D';
    if (h > 0) pDur += h + 'H';
    if (m > 0) pDur += m + 'M';
    return pDur;
}

async function handleTimerStop() {
    await handleTimerPause(); // Ensure it calculates last piece of time

    const data = await chrome.storage.local.get([
        'timerState', 'oauthToken', 'orgId', 'orgType',
        'timerRoundingInterval', 'timerRoundingDirection'
    ]);

    const state = data.timerState;
    if (!state || !state.taskKey || state.accumulatedMinutes <= 0) {
        showTimerStatus("Таймер пуст", "error");
        return;
    }

    const rawSessionMins = state.accumulatedMinutes;
    const intervalStr = data.timerRoundingInterval || "1";
    const dir = data.timerRoundingDirection || "math";

    const roundedMins = roundMinutes(rawSessionMins, parseInt(intervalStr, 10), dir);
    if (roundedMins <= 0) {
        showTimerStatus(`Время сессии слишком мало (${rawSessionMins}м)`, "error");
        return;
    }

    const durationIso = formatDuration(roundedMins);

    // Send API req
    const headers = {
        'Authorization': `OAuth ${data.oauthToken}`,
        'Content-Type': 'application/json'
    };
    if (data.orgType === 'cloud') headers['X-Cloud-Org-ID'] = data.orgId;
    else headers['X-Org-ID'] = data.orgId;

    try {
        timerStatus.className = 'timer-status-msg';
        timerStatus.textContent = 'Сохранение...';
        btnTimerStop.disabled = true;

        const startIso = new Date(Date.now() - roundedMins * 60000).toISOString().replace('Z', '+0000');

        const url = `https://api.tracker.yandex.net/v2/issues/${state.taskKey}/worklog`;
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                start: startIso,
                duration: durationIso
            })
        });

        if (!res.ok) throw new Error(`API ${res.status}`);

        showTimerStatus(`Учтено ${roundedMins}м`, "success");
        await handleTimerReset();

    } catch (e) {
        showTimerStatus(`Ошибка: ${e.message}`, "error");
    } finally {
        btnTimerStop.disabled = false;
    }
}

function showTimerStatus(msg, type) {
    timerStatus.textContent = msg;
    timerStatus.className = `timer-status-msg ${type}`;
    setTimeout(() => {
        timerStatus.textContent = '';
        timerStatus.className = 'timer-status-msg';
    }, 4000);
}

function extractTaskKey(raw) {
    if (!raw) return '';
    return raw.trim().split('/').pop().toUpperCase();
}

async function fetchSpentTime(taskKey) {
    if (!taskKey) return 0;
    try {
        const data = await chrome.storage.local.get(['oauthToken', 'orgId', 'orgType']);
        if (!data.oauthToken) return 0;

        const headers = {
            'Authorization': `OAuth ${data.oauthToken}`,
            'Content-Type': 'application/json'
        };
        if (data.orgType === 'cloud') headers['X-Cloud-Org-ID'] = data.orgId;
        else headers['X-Org-ID'] = data.orgId;

        const url = `https://api.tracker.yandex.net/v2/issues/${taskKey}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return 0;

        const issueObj = await res.json();
        const spentMs = issueObj.spent || 0;
        return Math.floor(spentMs / 60000); // ms to minutes
    } catch (e) {
        console.error("Failed to fetch spent time", e);
        return 0;
    }
}

async function initTimer() {
    const data = await chrome.storage.local.get(['timerState']);
    const state = data.timerState || { isRunning: false, taskKey: '', startTime: null, accumulatedMinutes: 0, previouslySpentMinutes: 0 };
    renderTimerUI(state);
    if (state.isRunning) startTimerUIUpdate();

    btnTimerStart.onclick = handleTimerStart;
    btnTimerPause.onclick = handleTimerPause;
    btnTimerReset.onclick = handleTimerReset;
    btnTimerStop.onclick = handleTimerStop;

    // Auto-fetch spent time on blur if stopped
    timerTask.addEventListener('blur', async () => {
        const key = extractTaskKey(timerTask.value);
        if (!key) return;

        const { timerState } = await chrome.storage.local.get(['timerState']);
        if (!timerState || !timerState.isRunning || timerState.taskKey !== key) {
            timerStatus.textContent = "Проверка данных...";
            const spentMins = await fetchSpentTime(key);
            timerStatus.textContent = "";

            const newState = {
                isRunning: false,
                taskKey: key,
                startTime: null,
                accumulatedMinutes: 0,
                previouslySpentMinutes: spentMins
            };
            await chrome.storage.local.set({ timerState: newState });
            renderTimerUI(newState);
        }
    });

    // Allow manual edits if paused
    timerMinutes.addEventListener('change', async () => {
        const { timerState } = await chrome.storage.local.get(['timerState']);
        if (!timerState || !timerState.isRunning) {
            let displayedMins = parseInt(timerMinutes.value, 10) || 0;
            if (displayedMins < 0) displayedMins = 0;

            const prev = timerState ? (timerState.previouslySpentMinutes || 0) : 0;
            const newAccumulated = Math.max(0, displayedMins - prev);

            await chrome.storage.local.set({
                timerState: { ...timerState, accumulatedMinutes: newAccumulated }
            });
        }
    });
}

async function init() {
    try {
        const data = await chrome.storage.local.get(['oauthToken', 'orgId', 'orgType', 'language', 'dashboardStatuses', 'dashboardRoles']);

        if (!data.oauthToken || !data.orgId) {
            throw new Error("Необходима авторизация. Откройте настройки.");
        }
        if (!data.dashboardStatuses || data.dashboardStatuses.length === 0) {
            throw new Error("Не выбраны статусы для отображения. Откройте настройки.");
        }

        const roles = data.dashboardRoles || ['Assignee', 'Author', 'Followers'];
        if (roles.length === 0) {
            throw new Error("Не выбраны роли для отображения. Откройте настройки.");
        }

        const statusesStr = data.dashboardStatuses.map(s => `"${s}"`).join(', ');
        const rolesStr = roles.map(r => `${r}: me()`).join(' OR ');
        const oql = `Status: ${statusesStr} AND (${rolesStr})`;

        const headers = {
            'Authorization': `OAuth ${data.oauthToken}`,
            'Content-Type': 'application/json',
            'Accept-Language': data.language || 'ru'
        };
        if (data.orgType === 'cloud') headers['X-Cloud-Org-ID'] = data.orgId;
        else headers['X-Org-ID'] = data.orgId;

        const response = await fetch('https://api.tracker.yandex.net/v2/issues/_search', {
            method: 'POST', headers, body: JSON.stringify({ query: oql })
        });

        if (!response.ok) throw new Error(`Ошибка API: ${response.status}`);
        const issues = await response.json();

        const grouped = {};
        data.dashboardStatuses.forEach(s => grouped[s] = 0);

        issues.forEach(issue => {
            const statusName = issue.status?.display || issue.status?.name || 'Unknown';
            if (grouped[statusName] !== undefined) grouped[statusName]++;
            else grouped[statusName] = 1;
        });

        spinner.style.display = 'none';

        Object.keys(grouped).forEach(status => {
            if (grouped[status] === 0) return;

            const row = document.createElement('div');
            row.className = 'status-row';
            row.innerHTML = `<span class="status-name">${status}</span><span class="status-count">${grouped[status]}</span>`;

            row.onclick = () => {
                const rowOql = `Status: "${status}" AND (${rolesStr})`;
                const url = `https://tracker.yandex.ru/issues?_q=${encodeURIComponent(rowOql)}`;
                chrome.tabs.create({ url });
            };
            content.appendChild(row);
        });

        if (content.children.length === 0) content.textContent = "Нет задач в выбранных статусах.";

    } catch (err) {
        spinner.style.display = 'none';
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTimer();
    init();
    document.getElementById('settingsBtn').addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    });
});
