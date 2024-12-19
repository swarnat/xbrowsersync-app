import { ApiSyncInfo } from '../api/api.interface';
import { Bookmark } from '../bookmark/bookmark.interface';
import { BookmarkHelperService } from '../bookmark/bookmark-helper/bookmark-helper.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  BaseError,
  BookmarkMappingNotFoundError,
  BookmarkNotFoundError,
  ContainerChangedError,
  DataOutOfSyncError,
  FailedCreateNativeBookmarksError,
  FailedGetNativeBookmarksError,
  FailedRemoveNativeBookmarksError,
  IncompleteSyncInfoError,
  NativeBookmarkNotFoundError,
  SyncDisabledError,
  SyncFailedError,
  SyncNotFoundError,
  SyncUncommittedError,
  SyncVersionNotSupportedError,
  TooManyRequestsError
} from '../errors/errors';
import { ExceptionHandler } from '../errors/errors.interface';
import { PlatformService } from '../global-shared.interface';
import { LogService } from '../log/log.service';
import { NetworkService } from '../network/network.service';
import { StoreKey } from '../store/store.enum';
import { StoreService } from '../store/store.service';
import { UtilityService } from '../utility/utility.service';
import { BookmarkSyncProviderService } from './bookmark-sync-provider/bookmark-sync-provider.service';
import { SyncType } from './sync.enum';
import { RemovedSync, Sync, SyncProvider } from './sync.interface';
import angular from 'angular';
import { Injectable } from 'angular-ts-decorators';

@Injectable('SyncService')
export class SyncService {
  $exceptionHandler: ExceptionHandler;
  $q: ng.IQService;
  $timeout: ng.ITimeoutService;
  bookmarkHelperSvc: BookmarkHelperService;
  cryptoSvc: CryptoService;
  logSvc: LogService;
  networkSvc: NetworkService;
  platformSvc: PlatformService;
  storeSvc: StoreService;
  utilitySvc: UtilityService;

  currentSync: Sync;
  providers: SyncProvider[];

  // IMPORTANT: For web extension platforms, as syncQueue is stored in memory it should NEVER be
  // referenced directly in code running in the context of the browser action, only in the background page
  syncQueue: Sync[] = [];

  static $inject = [
    '$exceptionHandler',
    '$q',
    '$timeout',
    'BookmarkHelperService',
    'BookmarkSyncProviderService',
    'CryptoService',
    'LogService',
    'NetworkService',
    'PlatformService',
    'StoreService',
    'UtilityService'
  ];
  constructor(
    $exceptionHandler: ExceptionHandler,
    $q: ng.IQService,
    $timeout: ng.ITimeoutService,
    BookmarkHelperSvc: BookmarkHelperService,
    BookmarkSyncProviderSvc: BookmarkSyncProviderService,
    CryptoSvc: CryptoService,
    LogSvc: LogService,
    NetworkSvc: NetworkService,
    PlatformSvc: PlatformService,
    StoreSvc: StoreService,
    UtilitySvc: UtilityService
  ) {
    this.$exceptionHandler = $exceptionHandler;
    this.$q = $q;
    this.$timeout = $timeout;
    this.bookmarkHelperSvc = BookmarkHelperSvc;
    this.cryptoSvc = CryptoSvc;
    this.logSvc = LogSvc;
    this.networkSvc = NetworkSvc;
    this.platformSvc = PlatformSvc;
    this.storeSvc = StoreSvc;
    this.utilitySvc = UtilitySvc;

    // Register sync providers
    this.providers = [BookmarkSyncProviderSvc];
  }

  cancelSync(): ng.IPromise<void> {
    return this.disableSync();
  }

  checkIfDisableSyncOnError(err: Error): boolean {
    return (
      err &&
      (err instanceof IncompleteSyncInfoError ||
        err instanceof SyncNotFoundError ||
        err instanceof SyncVersionNotSupportedError ||
        err instanceof TooManyRequestsError)
    );
  }

  checkIfRefreshSyncedDataOnError(err: Error): boolean {
    return (
      err &&
      (err instanceof BookmarkMappingNotFoundError ||
        err instanceof ContainerChangedError ||
        err instanceof DataOutOfSyncError ||
        err instanceof FailedCreateNativeBookmarksError ||
        err instanceof FailedGetNativeBookmarksError ||
        err instanceof FailedRemoveNativeBookmarksError ||
        err instanceof NativeBookmarkNotFoundError ||
        err instanceof BookmarkNotFoundError)
    );
  }

  checkForUpdates(isBackgroundSync = false, outputToLog = true): ng.IPromise<boolean> {
    return this.storeSvc.get<string>(StoreKey.LastUpdated).then((storedLastUpdated) => {
      // Get last updated date from cache
      const storedLastUpdatedDate = new Date(storedLastUpdated);

      // Check if bookmarks have been updated
      return this.utilitySvc
        .getApiService()
        .then((apiSvc) => apiSvc.getBookmarksLastUpdated(isBackgroundSync))
        .then((response) => {
          // If last updated is different to the cached date, refresh bookmarks
          const remoteLastUpdated = new Date(response.lastUpdated);
          const updatesAvailable = storedLastUpdatedDate?.getTime() !== remoteLastUpdated.getTime();

          if (updatesAvailable && outputToLog) {
            this.logSvc.logInfo(
              `Updates available, local:${
                storedLastUpdatedDate?.toISOString() ?? 'none'
              } remote:${remoteLastUpdated.toISOString()}`
            );
          }

          return updatesAvailable;
        });
    });
  }

  checkSyncExists(): ng.IPromise<boolean> {
    return this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
      if (!syncEnabled) {
        throw new SyncDisabledError();
      }
      return this.utilitySvc
        .getApiService()
        .then((apiSvc) => apiSvc.getBookmarksLastUpdated())
        .then(() => true)
        .catch((err) => {
          // Handle sync removed from service
          if (err instanceof SyncNotFoundError) {
            this.setSyncRemoved();
            return false;
          }
          return true;
        });
    });
  }

  checkSyncVersionIsSupported(): ng.IPromise<void> {
    return this.utilitySvc.checkSyncCredentialsExist().then((syncInfo) =>
      this.$q
        .all([
          this.utilitySvc.getApiService().then((apiSvc) => apiSvc.getSyncVersion(syncInfo.id)),
          this.platformSvc.getAppVersion()
        ])
        .then((results) => {
          const [response, appVersion] = results;
          const { version: bookmarksVersion } = response;
          if (this.utilitySvc.compareVersions(bookmarksVersion ?? '0', appVersion, '>')) {
            throw new SyncVersionNotSupportedError();
          }
        })
    );
  }

  disableSync(): ng.IPromise<void> {
    return this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
      if (!syncEnabled) {
        return;
      }

      // Disable sync update check and clear cached data
      return this.$q
        .all([
          this.platformSvc.stopSyncUpdateChecks(),
          this.storeSvc.get<ApiSyncInfo>(StoreKey.SyncInfo).then((syncInfo) => {
            const { password, ...syncInfoNoPassword } = syncInfo;
            return this.storeSvc.set(StoreKey.SyncInfo, syncInfoNoPassword);
          }),
          this.storeSvc.remove(StoreKey.LastUpdated),
          this.storeSvc.set(StoreKey.SyncEnabled, false)
        ])
        .then(() => {
          // Disable syncing for registered providers
          return this.$q.all(this.providers.map((provider) => provider.disable()));
        })
        .then(() => {
          // Clear sync queue
          this.syncQueue = [];

          // Reset syncing flag
          this.showInterfaceAsSyncing();

          // Update browser action icon
          this.platformSvc.refreshNativeInterface();
          this.logSvc.logInfo('Sync disabled');
        });
    });
  }

  enableSync(): ng.IPromise<void> {
    return this.$q
      .all([
        this.storeSvc.remove(StoreKey.RemovedSync),
        this.storeSvc.set(StoreKey.SyncEnabled, true),
        this.platformSvc.startSyncUpdateChecks()
      ])
      .then(() => {
        // Enable syncing for registered providers
        return this.$q.all(this.providers.map((provider) => provider.enable()));
      })
      .then(() => this.platformSvc.refreshNativeInterface(true));
  }

  executeSync(isBackgroundSync = false): ng.IPromise<void> {
    // Check if sync enabled before running sync
    return this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
      if (!syncEnabled) {
        throw new SyncDisabledError();
      }

      // Get available updates if there are no queued syncs, finally process the queue
      return (
        this.syncQueue.length === 0 ? this.checkForUpdates(isBackgroundSync).catch(() => true) : this.$q.resolve(false)
      )
        .then((updatesAvailable) => {
          return (
            updatesAvailable &&
            this.queueSync({
              type: SyncType.Local
            })
          );
        })
        .then(() => this.processSyncQueue(isBackgroundSync));
    });
  }

  getCurrentSync(): Sync {
    return this.currentSync;
  }

  getSyncQueueLength(): number {
    return this.syncQueue.length;
  }

  getSyncSize(): ng.IPromise<number> {
    return this.bookmarkHelperSvc
      .getCachedBookmarks()
      .then(() => this.storeSvc.get<string>(StoreKey.Bookmarks))
      .then((encryptedBookmarks) => {
        // Return size in bytes of cached encrypted bookmarks
        const sizeInBytes = new TextEncoder().encode(encryptedBookmarks).byteLength;
        return sizeInBytes;
      });
  }

  handleFailedSync(failedSync: Sync, err: Error, isBackgroundSync = false): ng.IPromise<void> {
    let syncError = err;
    return this.$q
      .resolve()
      .then(() => {
        // If connection failed and sync is a change, swallow error and place failed sync back on the queue
        if (this.networkSvc.isNetworkConnectionError(err) && failedSync.type !== SyncType.Local) {
          this.syncQueue.unshift(failedSync);
          if (!isBackgroundSync) {
            this.logSvc.logWarning('No connection, changes re-queued for syncing');
          }
          syncError = new SyncUncommittedError(undefined, err);
          return;
        }

        // Set default error if none set
        if (!(err instanceof BaseError)) {
          syncError = new SyncFailedError(undefined, err);
        }

        // Handle failed sync
        this.logSvc.logWarning(`Sync ${failedSync.uniqueId} failed`);
        this.$exceptionHandler(syncError, null, false);
        if (failedSync.changeInfo && failedSync.changeInfo.type) {
          this.logSvc.logInfo(failedSync.changeInfo);
        }
        return this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
          return this.showInterfaceAsSyncing().then(() => {
            if (!syncEnabled) {
              return;
            }

            // Handle sync removed from service
            if (err instanceof SyncNotFoundError) {
              return this.setSyncRemoved();
            }

            return this.$q
              .resolve()
              .then(() => {
                // If local changes made, clear sync queue and refresh sync data if necessary
                if (failedSync.type !== SyncType.Local) {
                  this.syncQueue = [];
                  if (this.checkIfRefreshSyncedDataOnError(syncError)) {
                    this.currentSync = undefined;
                    return this.platformSvc.queueLocalResync().catch((refreshErr) => {
                      syncError = refreshErr;
                    });
                  }
                }
              })
              .then(() => {
                // Check if sync should be disabled
                if (this.checkIfDisableSyncOnError(syncError)) {
                  return this.disableSync();
                }
              });
          });
        });
      })
      .then(() => {
        throw syncError;
      })
      .finally(() => {
        // Return sync error back to process that queued the sync
        failedSync.deferred.reject(syncError);
        return this.showInterfaceAsSyncing();
      });
  }

  processSyncQueue(isBackgroundSync = false): ng.IPromise<void> {
    let cancel = false;
    let processedBookmarksData: Bookmark[];
    let updateRemote = false;
    let updateSyncVersion = false;

    // If a sync is in progress, retry later
    if (this.currentSync || this.syncQueue.length === 0) {
      return this.$q.resolve();
    }

    const condition = (): ng.IPromise<boolean> => {
      return this.$q.resolve(this.syncQueue.length > 0);
    };

    const action = (): ng.IPromise<void> => {
      // Get first sync in the queue
      this.currentSync = this.syncQueue.shift();
      this.logSvc.logInfo(
        `Processing sync ${this.currentSync.uniqueId}${isBackgroundSync ? ' in background' : ''} (${
          this.syncQueue.length
        } waiting in queue)`
      );

      // Enable syncing flag
      return this.showInterfaceAsSyncing(this.currentSync.type)
        .then(() => {
          // Process here if this is a cancel
          if (this.currentSync.type === SyncType.Cancel) {
            return this.cancelSync().then(() => {
              cancel = true;
              return false;
            });
          }

          // Set update sync version flag if upgrading
          if (this.currentSync.type === SyncType.Upgrade) {
            updateSyncVersion = true;
          }

          // Set sync bookmarks to last processed result if applicable
          if (angular.isUndefined(this.currentSync.bookmarks) && !angular.isUndefined(processedBookmarksData)) {
            this.currentSync.bookmarks = processedBookmarksData;
          }

          // Process sync for each registered provider
          return this.$q
            .all(this.providers.map((provider) => provider.processSync(this.currentSync)))
            .then((processSyncResults) => {
              // Iterate through process results and extract resultant data
              processSyncResults.forEach((result, index) => {
                switch (this.providers[index].constructor) {
                  case BookmarkSyncProviderService:
                    processedBookmarksData = result.data;
                    break;
                  default:
                    this.logSvc.logWarning('Sync provider not specified');
                }
              });

              // Combine all results to determine whether to proceed with update
              return processSyncResults.reduce((prev, current) => {
                return current.updateRemote ? prev : prev && current.updateRemote;
              }, true);
            });
        })
        .then((syncChange) => {
          // Resolve the current sync's promise
          this.currentSync.deferred.resolve();

          // Set flag if remote bookmarks data should be updated
          updateRemote = !!syncChange;

          // Reset syncing flag
          return this.showInterfaceAsSyncing();
        });
    };

    // Disable automatic updates whilst processing syncs
    return (
      this.utilitySvc
        .isSyncEnabled()
        .then((syncEnabled) => {
          if (syncEnabled) {
            return this.platformSvc.stopSyncUpdateChecks();
          }
        })
        // Process sync queue
        .then(() => this.utilitySvc.asyncWhile<any>(this.syncQueue, condition, action))
        .then(() => {
          // If sync was cancelled stop here
          if (cancel) {
            return;
          }

          return this.cryptoSvc.encryptData(JSON.stringify(processedBookmarksData)).then((encryptedBookmarks) => {
            // Update remote bookmarks if required
            return (
              !updateRemote
                ? this.$q.resolve().then(() => this.logSvc.logInfo('No changes made, skipping remote update.'))
                : this.checkSyncVersionIsSupported()
                    .then(() =>
                      this.utilitySvc
                        .getApiService()
                        .then((apiSvc) =>
                          apiSvc.updateBookmarks(encryptedBookmarks, updateSyncVersion, isBackgroundSync)
                        )
                    )
                    .then((response) => {
                      const updateCache = [this.storeSvc.set(StoreKey.LastUpdated, response.lastUpdated)];
                      if (updateSyncVersion) {
                        updateCache.push(
                          this.platformSvc.getAppVersion().then((appVersion) =>
                            this.storeSvc.get<ApiSyncInfo>(StoreKey.SyncInfo).then((syncInfo) => {
                              syncInfo.version = appVersion;
                              return this.storeSvc.set(StoreKey.SyncInfo, syncInfo);
                            })
                          )
                        );
                      }
                      return this.$q.all(updateCache).then(() => {
                        this.logSvc.logInfo(`Remote bookmarks updated at ${response.lastUpdated}`);
                      });
                    })
                    .catch((err) => {
                      return this.$q
                        .all(
                          this.providers.map((provider) => {
                            let lastResult: any;
                            switch (provider.constructor) {
                              case BookmarkSyncProviderService:
                                lastResult = processedBookmarksData;
                                break;
                              default:
                            }
                            return provider.handleUpdateRemoteFailed(err, lastResult, this.currentSync);
                          })
                        )
                        .then(() => {
                          throw err;
                        });
                    })
            ).then(() => this.bookmarkHelperSvc.updateCachedBookmarks(processedBookmarksData, encryptedBookmarks));
          });
        })
        .catch((err) => this.handleFailedSync(this.currentSync, err, isBackgroundSync))
        .finally(() => {
          // Clear current sync
          this.currentSync = undefined;

          // Start auto updates if sync enabled
          return this.utilitySvc.isSyncEnabled().then((cachedSyncEnabled) => {
            if (cachedSyncEnabled) {
              return this.platformSvc.startSyncUpdateChecks();
            }
          });
        })
    );
  }

  queueSync(syncToQueue: Sync, runSync = true): ng.IPromise<void> {
    return this.$q<void>((resolve, reject) => {
      this.utilitySvc
        .isSyncEnabled()
        .then((syncEnabled) => {
          // If new sync ensure sync queue is clear
          if (!syncEnabled) {
            this.syncQueue = [];
          }

          let queuedSync: ng.IDeferred<void>;
          if (syncToQueue) {
            // If sync is type cancel, clear queue first
            if (syncToQueue.type === SyncType.Cancel) {
              this.syncQueue = [];
            }

            // Add sync to queue
            queuedSync = this.$q.defer<void>();
            syncToQueue.deferred = queuedSync;
            syncToQueue.uniqueId = syncToQueue.uniqueId ?? this.utilitySvc.getUniqueishId();
            this.syncQueue.push(syncToQueue);
            this.logSvc.logInfo(`Sync ${syncToQueue.uniqueId} (${syncToQueue.type}) queued`);
          }

          // Prepare sync promises to return and check if should also run sync
          const promises = [queuedSync.promise];
          if (runSync) {
            promises.push(
              this.$q<void>((syncedResolve, syncedReject) =>
                this.$timeout(() => this.processSyncQueue().then(syncedResolve).catch(syncedReject))
              )
            );
          }

          return this.$q
            .all(promises)
            .then(() => {
              // Enable sync if required
              if (
                !syncEnabled &&
                ((syncToQueue.type === SyncType.Local && angular.isUndefined(syncToQueue.bookmarks ?? undefined)) ||
                  syncToQueue.type === SyncType.Remote ||
                  syncToQueue.type === SyncType.Upgrade)
              ) {
                return this.enableSync().then(() => {
                  this.logSvc.logInfo('Sync enabled');
                });
              }
            })
            .then(resolve);
        })
        .catch(reject);
    });
  }

  setSyncRemoved(): ng.IPromise<void> {
    return this.$q
      .all([this.bookmarkHelperSvc.getCachedBookmarks(), this.storeSvc.get([StoreKey.LastUpdated, StoreKey.SyncInfo])])
      .then((data) => {
        const [bookmarks, storeContent] = data;
        const { lastUpdated, syncInfo } = storeContent;
        const { id, password, version, ...trimmedSyncInfo } = syncInfo;
        const removedSync: RemovedSync = {
          bookmarks,
          lastUpdated,
          syncInfo: trimmedSyncInfo
        };
        return this.storeSvc
          .set(StoreKey.RemovedSync, removedSync)
          .then(() => {
            this.logSvc.logWarning(
              `Sync ID ${syncInfo.id} was not found on remote servuce (last updated ${lastUpdated})`
            );
            this.logSvc.logInfo(trimmedSyncInfo);
          })
          .then(() => this.disableSync())
          .then(() => this.storeSvc.set(StoreKey.SyncInfo, trimmedSyncInfo));
      });
  }

  shouldDisplayDefaultPageOnError(err: Error): boolean {
    return this.checkIfDisableSyncOnError(err) || err instanceof SyncUncommittedError;
  }

  showInterfaceAsSyncing(syncType?: SyncType): ng.IPromise<void> {
    // Update browser action icon with current sync type
    if (!angular.isUndefined(syncType ?? undefined)) {
      return this.platformSvc.refreshNativeInterface(undefined, syncType);
    }

    // Get cached sync enabled value and update browser action icon
    return this.utilitySvc.isSyncEnabled().then((syncEnabled) => this.platformSvc.refreshNativeInterface(syncEnabled));
  }
}
