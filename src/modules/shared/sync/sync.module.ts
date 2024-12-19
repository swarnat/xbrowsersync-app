import { BookmarkSyncProviderService } from './bookmark-sync-provider/bookmark-sync-provider.service';
import { SyncService } from './sync.service';
import { NgModule } from 'angular-ts-decorators';

@NgModule({
  id: 'SyncModule',
  providers: [BookmarkSyncProviderService, SyncService]
})
export class SyncModule {}
