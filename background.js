chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('trackerCheck', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'trackerCheck') checkTracker();
});

chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.tabs.create({ url: `https://tracker.yandex.ru/${notificationId}` });
    chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkTrackerSilent') {
        checkTracker(true);
        sendResponse({ ok: true });
    }
});

async function checkTracker(isSilent = false) {
    try {
        const data = await chrome.storage.local.get(['oauthToken', 'orgId', 'orgType', 'language', 'rules', 'notified_issues']);
        if (!data.oauthToken || !data.orgId || !data.rules || data.rules.length === 0) {
            return;
        }

        const oqlParts = data.rules.map(rule => `(${rule.role}: me() AND Status: "${rule.status}")`);
        const oql = oqlParts.join(' OR ');

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

        if (!response.ok) {
            console.error(`Tracker API Error: ${response.status}`);
            return;
        }

        const issues = await response.json();

        const prevNotifiedIssues = data.notified_issues || {};
        const isFirstRun = !data.notified_issues;

        // Полностью пересобираем кеш только из тех задач, которые СЕЙЧАС подходят под условия
        let newNotifiedIssues = {};

        for (const issue of issues) {
            const issueKey = issue.key;
            const statusName = issue.status?.display || issue.status?.name || 'Unknown';
            const summary = issue.summary || '';

            // Запоминаем текущий статус задачи
            newNotifiedIssues[issueKey] = statusName;

            const prevStatus = prevNotifiedIssues[issueKey];

            // Если задачи не было в прошлом кеше (новая) ИЛИ у неё изменился статус (перешла)
            if (!prevStatus || prevStatus !== statusName) {
                // Не спамим уведомлениями при самом первом запуске или тихом обновлении настроек
                if (!isSilent && !isFirstRun) {
                    chrome.notifications.create(issueKey, {
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: 'Изменение статуса',
                        message: `[${issueKey}] ${summary} -> ${statusName}`
                    });
                }
            }
        }

        await chrome.storage.local.set({ notified_issues: newNotifiedIssues });
    } catch (error) {
        console.error("Background check failed:", error);
    }
}
