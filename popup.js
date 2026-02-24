const spinner = document.getElementById('spinner');
const content = document.getElementById('content');
const errorMsg = document.getElementById('error');

// Timer Elements
const timerTask = document.getElementById('timerTask');
const timerHours = document.getElementById('timerHours');
const timerMinutes = document.getElementById('timerMinutes');
const timerSeconds = document.getElementById('timerSeconds');
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
        timerHours.disabled = true;
        timerMinutes.disabled = true;
        timerSeconds.disabled = true;
        timerTask.disabled = true;
    } else {
        btnTimerStart.style.display = 'flex';
        btnTimerPause.style.display = 'none';
        timerHours.disabled = false;
        timerMinutes.disabled = false;
        timerSeconds.disabled = false;
        timerTask.disabled = false;
    }
    timerTask.value = state.taskKey || '';

    if (state.accumulatedSeconds === undefined && state.accumulatedMinutes !== undefined) {
        state.accumulatedSeconds = state.accumulatedMinutes * 60;
    }

    let sessionSecs = state.accumulatedSeconds || 0;
    if (state.isRunning && state.startTime) {
        sessionSecs += Math.floor((Date.now() - state.startTime) / 1000);
    }

    let previousMins = state.previouslySpentMinutes || 0;
    let totalSecs = (previousMins * 60) + sessionSecs;

    let h = Math.floor(totalSecs / 3600);
    let m = Math.floor((totalSecs % 3600) / 60);
    let s = totalSecs % 60;

    // Only update if not typing manually
    if (document.activeElement !== timerHours && document.activeElement !== timerMinutes && document.activeElement !== timerSeconds) {
        timerHours.value = h.toString().padStart(2, '0');
        timerMinutes.value = m.toString().padStart(2, '0');
        timerSeconds.value = s.toString().padStart(2, '0');
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
    }, 1000); // 1 sec update
}

function getManualTotalSeconds() {
    let h = parseInt(timerHours.value, 10) || 0;
    let m = parseInt(timerMinutes.value, 10) || 0;
    let s = parseInt(timerSeconds.value, 10) || 0;
    return (h * 3600) + (m * 60) + s;
}

async function handleTimerStart() {
    const rawTask = timerTask.value.trim();
    if (!rawTask) {
        showTimerStatus("Укажите задачу", "error");
        return;
    }

    const taskKey = extractTaskKey(rawTask);

    const { timerState } = await chrome.storage.local.get(['timerState']);
    let previousMins = 0;
    let manualSessionSecs = 0;

    let displayedTotalSecs = getManualTotalSeconds();

    if (timerState && timerState.taskKey === taskKey && !timerState.isRunning) {
        previousMins = timerState.previouslySpentMinutes || 0;
        manualSessionSecs = Math.max(0, displayedTotalSecs - (previousMins * 60));
    } else {
        previousMins = await fetchSpentTime(taskKey);
        manualSessionSecs = Math.max(0, displayedTotalSecs - (previousMins * 60));
    }

    const state = {
        isRunning: true,
        taskKey: taskKey,
        startTime: Date.now(),
        accumulatedSeconds: manualSessionSecs,
        previouslySpentMinutes: previousMins
    };

    await chrome.storage.local.set({ timerState: state });
    renderTimerUI(state);
    startTimerUIUpdate();
}

async function handleTimerPause() {
    const { timerState } = await chrome.storage.local.get(['timerState']);
    if (timerState && timerState.isRunning) {
        if (timerState.accumulatedSeconds === undefined && timerState.accumulatedMinutes !== undefined) {
            timerState.accumulatedSeconds = timerState.accumulatedMinutes * 60;
        }
        const elapsed = Math.floor((Date.now() - timerState.startTime) / 1000);
        timerState.accumulatedSeconds = (timerState.accumulatedSeconds || 0) + elapsed;
        timerState.isRunning = false;
        timerState.startTime = null;
        await chrome.storage.local.set({ timerState });
        renderTimerUI(timerState);
        if (uiInterval) clearInterval(uiInterval);
    }
}

async function handleTimerReset() {
    await chrome.storage.local.set({ timerState: { isRunning: false, taskKey: '', startTime: null, accumulatedSeconds: 0, previouslySpentMinutes: 0 } });
    renderTimerUI({ isRunning: false, taskKey: '', startTime: null, accumulatedSeconds: 0, previouslySpentMinutes: 0 });
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
    if (!state || !state.taskKey || state.accumulatedSeconds <= 0) {
        showTimerStatus("Таймер пуст", "error");
        return;
    }

    const rawSessionMins = state.accumulatedSeconds / 60;
    const intervalStr = data.timerRoundingInterval || "1";
    const dir = data.timerRoundingDirection || "math";

    const roundedMins = roundMinutes(rawSessionMins, parseInt(intervalStr, 10), dir);
    if (roundedMins <= 0) {
        const mm = Math.floor(state.accumulatedSeconds / 60);
        const ss = state.accumulatedSeconds % 60;
        showTimerStatus(`Время сессии слишком мало (${mm}м ${ss}с)`, "error");
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
    const state = data.timerState || { isRunning: false, taskKey: '', startTime: null, accumulatedSeconds: 0, previouslySpentMinutes: 0 };
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
                accumulatedSeconds: 0,
                previouslySpentMinutes: spentMins
            };
            await chrome.storage.local.set({ timerState: newState });
            renderTimerUI(newState);
        }
    });

    // Allow manual edits if paused
    const handleManualTimeEdit = async () => {
        const { timerState } = await chrome.storage.local.get(['timerState']);
        if (!timerState || !timerState.isRunning) {
            let displayedTotalSecs = getManualTotalSeconds();
            if (displayedTotalSecs < 0) displayedTotalSecs = 0;

            const prevMins = timerState ? (timerState.previouslySpentMinutes || 0) : 0;
            const newAccumulatedSecs = Math.max(0, displayedTotalSecs - (prevMins * 60));

            await chrome.storage.local.set({
                timerState: { ...timerState, accumulatedSeconds: newAccumulatedSecs }
            });
            // Re-render to format padStart
            renderTimerUI({ ...timerState, accumulatedSeconds: newAccumulatedSecs });
        }
    };

    timerHours.addEventListener('change', handleManualTimeEdit);
    timerMinutes.addEventListener('change', handleManualTimeEdit);
    timerSeconds.addEventListener('change', handleManualTimeEdit);
}

async function init() {
    try {
        const data = await chrome.storage.local.get(['oauthToken', 'orgId', 'orgType', 'language', 'dashboardStatuses', 'dashboardRoles']);

        if (!data.oauthToken || !data.orgId) {
            throw new Error("Необходима авторизация. Откройте настройки.");
        }

        // Показываем таймер только если есть токен и оргИД
        document.getElementById('timerSection').style.display = 'flex';

        if (!data.dashboardStatuses || data.dashboardStatuses.length === 0) {
            throw new Error("Не выбраны статусы для отображения. Откройте настройки.");
        }

        const roles = data.dashboardRoles || ['Assignee', 'Author', 'Followers'];
        if (roles.length === 0) {
            throw new Error("Не выбраны роли для отображения. Откройте настройки.");
        }

        const roleQueries = {
            'Assignee': 'Assignee: me()',
            'Author': 'Author: me()',
            'Followers': 'Followers: me()'
        };
        const roleEmojis = {
            'Assignee': '👨‍💻',
            'Author': '📝',
            'Followers': '👀'
        };

        const statusesStr = data.dashboardStatuses.map(s => `"${s}"`).join(', ');

        const headers = {
            'Authorization': `OAuth ${data.oauthToken}`,
            'Content-Type': 'application/json',
            'Accept-Language': data.language || 'ru'
        };
        if (data.orgType === 'cloud') headers['X-Cloud-Org-ID'] = data.orgId;
        else headers['X-Org-ID'] = data.orgId;

        // Делаем запросы последовательно, чтобы избежать ошибки 429 (Too Many Requests) от Яндекса
        const results = [];
        for (const role of roles) {
            const oql = `Status: ${statusesStr} AND ${roleQueries[role]}`;
            const response = await fetch('https://api.tracker.yandex.net/v2/issues/_search', {
                method: 'POST', headers, body: JSON.stringify({ query: oql })
            });

            if (response.status === 429) {
                // Если все равно словили 429, пробуем подождать секунду и повторить 1 раз
                await new Promise(res => setTimeout(res, 1000));
                const retryResponse = await fetch('https://api.tracker.yandex.net/v2/issues/_search', {
                    method: 'POST', headers, body: JSON.stringify({ query: oql })
                });
                if (!retryResponse.ok) throw new Error(`Ошибка API (Rate Limit): ${retryResponse.status}`);
                const issues = await retryResponse.json();
                results.push({ role, issues });
            } else if (!response.ok) {
                throw new Error(`Ошибка API: ${response.status}`);
            } else {
                const issues = await response.json();
                results.push({ role, issues });
            }
        }

        const grouped = {};
        data.dashboardStatuses.forEach(s => {
            grouped[s] = {};
            roles.forEach(r => grouped[s][r] = 0);
        });

        let totalIssuesFound = 0;

        results.forEach(({ role, issues }) => {
            issues.forEach(issue => {
                const statusName = issue.status?.display || issue.status?.name || 'Unknown';
                if (grouped[statusName] !== undefined && grouped[statusName][role] !== undefined) {
                    grouped[statusName][role]++;
                    totalIssuesFound++;
                }
            });
        });

        spinner.style.display = 'none';

        Object.keys(grouped).forEach(status => {
            const roleCounts = grouped[status];
            const hasAny = roles.some(r => roleCounts[r] > 0);
            if (!hasAny) return;

            const row = document.createElement('div');
            row.className = 'status-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'status-name';
            nameSpan.textContent = status;
            row.appendChild(nameSpan);

            const rolesDiv = document.createElement('div');
            rolesDiv.className = 'status-roles';

            roles.forEach(role => {
                if (roleCounts[role] > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'role-badge';

                    let roleTitle = '';
                    if (role === 'Assignee') roleTitle = 'Исполнитель';
                    else if (role === 'Author') roleTitle = 'Автор';
                    else if (role === 'Followers') roleTitle = 'Наблюдатель';

                    badge.title = roleTitle;
                    badge.textContent = `${roleEmojis[role]} ${roleCounts[role]}`;

                    badge.onclick = (e) => {
                        e.stopPropagation();
                        const rowOql = `Status: "${status}" AND ${roleQueries[role]}`;
                        const url = `https://tracker.yandex.ru/issues?_q=${encodeURIComponent(rowOql)}`;
                        chrome.tabs.create({ url });
                    };
                    rolesDiv.appendChild(badge);
                }
            });

            row.appendChild(rolesDiv);

            // Клик по всей строке - открываем все выбранные роли для этого статуса
            row.onclick = () => {
                const rolesOrStr = roles.map(r => roleQueries[r]).join(' OR ');
                const rowOql = `Status: "${status}" AND (${rolesOrStr})`;
                const url = `https://tracker.yandex.ru/issues?_q=${encodeURIComponent(rowOql)}`;
                chrome.tabs.create({ url });
            };

            content.appendChild(row);
        });

        if (totalIssuesFound === 0) content.textContent = "Нет задач в выбранных статусах.";

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
