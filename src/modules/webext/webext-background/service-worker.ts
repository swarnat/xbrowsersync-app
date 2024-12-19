import Globals from '../../shared/global-shared.constants';
import { MessageCommand } from '../../shared/global-shared.enum';
import { StoreKey } from '../../shared/store/store.enum';
import browser, { Downloads } from 'webextension-polyfill';

// Types
interface Alert {
  message: string;
  title: string;
}

interface DownloadMessage {
  command: MessageCommand;
  filename: string;
  textContents: string;
  displaySaveDialog?: boolean;
}

interface AutoBackupSchedule {
  autoBackUpHour: string;
  autoBackUpMinute: string;
  autoBackUpUnit: 'day' | 'week' | 'month';
  autoBackUpNumber: string;
}

interface AutoBackupMessage {
  command: MessageCommand;
  schedule: AutoBackupSchedule;
}

interface SyncMessage {
  command: MessageCommand;
  sync?: unknown;
  runSync?: boolean;
}

interface RestoreMessage {
  command: MessageCommand;
  sync: unknown;
}

// Constants
const NOTIFICATION_ICON = `${Globals.PathToAssets}/notification.svg`;
let notificationClickHandlers: Array<{ id: string; eventHandler: () => void }> = [];

console.log('init');
// Store service implementation
const store = {
  async get(key: string) {
    const result = await browser.storage.local.get(key);
    return result[key];
  },
  async set(key: string, value: unknown) {
    return browser.storage.local.set({ [key]: value });
  }
};

// Utility functions
const getUniqueId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

// Sync state
let currentSync: unknown = null;
let syncQueue: unknown[] = [];

// Function declarations
async function executeSync(): Promise<void> {
  // Exit if currently syncing
  if (currentSync) {
    return;
  }

  // Exit if sync not enabled
  const syncEnabled = await store.get(StoreKey.SyncEnabled);
  if (!syncEnabled) {
    return;
  }

  // Process sync queue sequentially
  await syncQueue.reduce(async (promise, sync) => {
    await promise;
    currentSync = sync;
    syncQueue = syncQueue.filter((s) => s !== sync);

    try {
      // Update icon to show syncing
      await browser.action.setIcon({ path: 'assets/uploading.png' });

      // Process sync
      // Note: Actual sync implementation would go here
      // This is a simplified version
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
      });

      // Update icon to show synced
      await browser.action.setIcon({ path: 'assets/synced.png' });
    } catch (err) {
      // Handle network errors
      if (err instanceof Error && err.name === 'NetworkError') {
        console.log('Could not check for updates, no connection');
        return;
      }
      throw err;
    } finally {
      currentSync = null;
    }
  }, Promise.resolve());
}

async function queueSync(sync: unknown, runSync = true): Promise<void> {
  syncQueue.push(sync);
  if (runSync) {
    return executeSync();
  }
}

async function checkForSyncUpdates(): Promise<void> {
  return executeSync();
}

async function handleSyncBookmarks(message: SyncMessage): Promise<void> {
  const { sync, runSync } = message;

  // If no sync provided, process current sync queue and check for updates
  if (!sync) {
    return executeSync();
  }

  return queueSync(sync, runSync);
}

async function handleRestoreBookmarks(message: RestoreMessage): Promise<void> {
  const { sync } = message;
  return queueSync(sync);
}

async function getCurrentSync(): Promise<unknown> {
  return currentSync;
}

async function getSyncQueueLength(): Promise<number> {
  return syncQueue.length;
}

async function disableSync(): Promise<void> {
  currentSync = null;
  syncQueue = [];
  await store.set(StoreKey.SyncEnabled, false);
  await browser.action.setIcon({ path: 'assets/notsynced.png' });
}

function enableEventListeners(): void {}
function disableEventListeners(): void {}

async function enableAutoBackup(message: AutoBackupMessage): Promise<void> {
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

  let periodInMinutes: number;
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

  await browser.alarms.clear('autoBackup');
  await browser.alarms.create('autoBackup', {
    delayInMinutes,
    periodInMinutes
  });
}

async function disableAutoBackup(): Promise<void> {
  await browser.alarms.clear('autoBackup');
}

async function handleDownloadFile(message: DownloadMessage): Promise<void> {
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

    return await new Promise<void>((resolve, reject) => {
      const onChanged = (delta: Downloads.OnChangedDownloadDeltaType) => {
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

async function displayAlert(alert: Alert, url?: string): Promise<void> {
  const urlRegex = new RegExp(Globals.URL.ValidUrlRegex, 'i');
  const urlInAlert = alert.message.match(urlRegex)?.find(Boolean);

  const options = {
    iconUrl: NOTIFICATION_ICON,
    message: alert.message,
    title: alert.title,
    type: 'basic' as const
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

// Event Listeners
browser.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm?.name) {
    case 'autoBackup':
      // Trigger auto backup
      await browser.runtime.sendMessage({ command: MessageCommand.EnableAutoBackUp });
      break;
    case Globals.Alarms.SyncUpdatesCheck.Name:
      // Check for sync updates
      await checkForSyncUpdates();
      break;
    default:
      // No action needed for unknown alarms
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

// Message handling
browser.runtime.onMessage.addListener(
  async (message: SyncMessage | RestoreMessage | DownloadMessage | AutoBackupMessage) => {
    console.log(message);
    try {
      switch (message.command) {
        case MessageCommand.SyncBookmarks:
          return await handleSyncBookmarks(message as SyncMessage);
        case MessageCommand.RestoreBookmarks:
          return await handleRestoreBookmarks(message as RestoreMessage);
        case MessageCommand.GetCurrentSync:
          return await getCurrentSync();
        case MessageCommand.GetSyncQueueLength:
          return await getSyncQueueLength();
        case MessageCommand.DisableSync:
          return await disableSync();
        case MessageCommand.DownloadFile:
          return await handleDownloadFile(message as DownloadMessage);
        case MessageCommand.EnableEventListeners:
          return enableEventListeners();
        case MessageCommand.DisableEventListeners:
          return disableEventListeners();
        case MessageCommand.EnableAutoBackUp:
          return await enableAutoBackup(message as AutoBackupMessage);
        case MessageCommand.DisableAutoBackUp:
          return await disableAutoBackup();
        default:
          throw new Error('Unknown command');
      }
    } catch (err) {
      if (err instanceof Error) {
        err.message = err.constructor.name;
      }
      throw err;
    }
  }
);

// Initialize
async function initialize(): Promise<void> {
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
