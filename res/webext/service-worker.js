import Globals from '../src/modules/shared/global-shared.constants';
import { MessageCommand } from '../src/modules/shared/global-shared.enum';
import { StoreKey } from '../src/modules/shared/store/store.enum';
import browser from 'webextension-polyfill';

// Constants
const NOTIFICATION_ICON = `${Globals.PathToAssets}/notification.svg`;
let notificationClickHandlers = [];

// Store service implementation
const store = {
  async get(key) {
    const result = await browser.storage.local.get(key);
    return result[key];
  },
  async set(key, value) {
    return browser.storage.local.set({ [key]: value });
  }
};

// Utility functions
const getUniqueId = () => {
  return Math.random().toString(36).substr(2, 9);
};
console.log(browser);
// Event Listeners
browser.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm?.name) {
    case Globals.Alarms.AutoBackUp.Name:
      // Trigger auto backup
      await browser.runtime.sendMessage({ command: MessageCommand.AutoBackUp });
      break;
    case Globals.Alarms.SyncUpdatesCheck.Name:
      // Check for sync updates
      await checkForSyncUpdates();
      break;
  }
});

browser.notifications.onClicked.addListener((notificationId) => {
  const handler = notificationClickHandlers.find((x) => x.id === notificationId);
  if (handler) {
    handler.eventHandler();
    browser.notifications.clear(notificationId);
  }
});

browser.notifications.onClosed.addListener((notificationId) => {
  notificationClickHandlers = notificationClickHandlers.filter((x) => x.id !== notificationId);
});

// Sync state
let currentSync = null;
let syncQueue = [];

// Message handling
browser.runtime.onMessage.addListener(async (message) => {
  console.log(message);
  try {
    switch (message.command) {
      case MessageCommand.SyncBookmarks:
        return await handleSyncBookmarks(message);
      case MessageCommand.RestoreBookmarks:
        return await handleRestoreBookmarks(message);
      case MessageCommand.GetCurrentSync:
        return await getCurrentSync();
      case MessageCommand.GetSyncQueueLength:
        return await getSyncQueueLength();
      case MessageCommand.DisableSync:
        return await disableSync();
      case MessageCommand.DownloadFile:
        return await handleDownloadFile(message);
      case MessageCommand.EnableEventListeners:
        return enableEventListeners();
      case MessageCommand.DisableEventListeners:
        return disableEventListeners();
      case MessageCommand.EnableAutoBackUp:
        return await enableAutoBackup(message);
      case MessageCommand.DisableAutoBackUp:
        return await disableAutoBackup();
      default:
        throw new Error('Unknown command');
    }
  } catch (err) {
    err.message = err.constructor.name;
    throw err;
  }
});

// Helper functions
async function displayAlert(alert, url) {
  const urlRegex = new RegExp(Globals.URL.ValidUrlRegex, 'i');
  const urlInAlert = alert.message.match(urlRegex)?.find(Boolean);

  const options = {
    iconUrl: NOTIFICATION_ICON,
    message: alert.message,
    title: alert.title,
    type: 'basic'
  };

  const notificationId = await browser.notifications.create(getUniqueId(), options);

  const urlToOpen = urlInAlert ?? url;
  if (urlToOpen) {
    notificationClickHandlers.push({
      id: notificationId,
      eventHandler: () => browser.tabs.create({ url: urlToOpen })
    });
  }
}

async function handleDownloadFile(message) {
  const { filename, textContents, displaySaveDialog = true } = message;

  if (!filename || !textContents) {
    throw new Error('Missing required parameters');
  }

  const file = new Blob([textContents], { type: 'text/plain' });
  const url = URL.createObjectURL(file);

  try {
    const downloadId = await browser.downloads.download({
      filename,
      saveAs: displaySaveDialog,
      url
    });

    return await new Promise((resolve, reject) => {
      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;

        if (delta.state?.current === 'complete') {
          URL.revokeObjectURL(url);
          browser.downloads.onChanged.removeListener(onChanged);
          resolve();
        } else if (delta.state?.current === 'interrupted') {
          URL.revokeObjectURL(url);
          browser.downloads.onChanged.removeListener(onChanged);
          if (delta.error?.current === 'USER_CANCELED') {
            resolve();
          } else {
            reject(new Error('Download failed'));
          }
        }
      };

      browser.downloads.onChanged.addListener(onChanged);
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function enableAutoBackup(message) {
  const { schedule } = message;

  // Calculate alarm delay and period
  const now = new Date();
  const runTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    parseInt(schedule.autoBackUpHour, 10),
    parseInt(schedule.autoBackUpMinute, 10)
  );

  if (runTime < now) {
    runTime.setDate(now.getDate() + 1);
  }

  const delayInMinutes = Math.round((runTime.getTime() - now.getTime()) / 1000 / 60);

  let periodInMinutes;
  switch (schedule.autoBackUpUnit) {
    case 'week':
      periodInMinutes = 60 * 24 * 7;
      break;
    case 'month':
      periodInMinutes = 60 * 24 * (365 / 12);
      break;
    case 'day':
    default:
      periodInMinutes = 60 * 24;
  }
  periodInMinutes *= parseInt(schedule.autoBackUpNumber, 10);

  await browser.alarms.clear(Globals.Alarms.AutoBackUp.Name);
  await browser.alarms.create(Globals.Alarms.AutoBackUp.Name, {
    delayInMinutes,
    periodInMinutes
  });
}

async function disableAutoBackup() {
  await browser.alarms.clear(Globals.Alarms.AutoBackUp.Name);
}

// Sync-related functions
async function handleSyncBookmarks(message) {
  const { sync, runSync } = message;

  // If no sync provided, process current sync queue and check for updates
  if (!sync) {
    return executeSync();
  }

  return queueSync(sync, runSync);
}

async function handleRestoreBookmarks(message) {
  const { sync } = message;
  return queueSync(sync);
}

async function getCurrentSync() {
  return currentSync;
}

async function getSyncQueueLength() {
  return syncQueue.length;
}

async function disableSync() {
  currentSync = null;
  syncQueue = [];
  await store.set(StoreKey.SyncEnabled, false);
  await browser.action.setIcon({ path: 'assets/notsynced.png' });
}

async function queueSync(sync, runSync = true) {
  syncQueue.push(sync);
  if (runSync) {
    return executeSync();
  }
}

async function executeSync() {
  // Exit if currently syncing
  if (currentSync) {
    return;
  }

  // Exit if sync not enabled
  const syncEnabled = await store.get(StoreKey.SyncEnabled);
  if (!syncEnabled) {
    return;
  }

  // Process sync queue
  while (syncQueue.length > 0) {
    currentSync = syncQueue.shift();
    try {
      // Update icon to show syncing
      await browser.action.setIcon({ path: 'assets/uploading.png' });

      // Process sync
      // Note: Actual sync implementation would go here
      // This is a simplified version
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update icon to show synced
      await browser.action.setIcon({ path: 'assets/synced.png' });
    } catch (err) {
      // Handle network errors
      if (err.name === 'NetworkError') {
        console.log('Could not check for updates, no connection');
        return;
      }
      throw err;
    } finally {
      currentSync = null;
    }
  }
}

async function checkForSyncUpdates() {
  return executeSync();
}

// Initialize
async function initialize() {
  const syncEnabled = await store.get(StoreKey.SyncEnabled);

  // Update browser action icon
  await browser.action.setIcon({
    path: syncEnabled ? 'assets/synced.png' : 'assets/notsynced.png'
  });

  // Check for updates if sync is enabled
  if (syncEnabled) {
    setTimeout(() => checkForSyncUpdates(), 3000);

    // Set up periodic sync check
    await browser.alarms.create(Globals.Alarms.SyncUpdatesCheck.Name, {
      periodInMinutes: 5
    });
  }
}

// Start initialization
initialize().catch(console.error);
