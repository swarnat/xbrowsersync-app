import 'angular-hammer';
import { AndroidBookmarkService } from './android-bookmark/android-bookmark.service';
import { AndroidPlatformService } from './android-platform/android-platform.service';
import { AndroidStoreService } from './android-store/android-store.service';
import { AndroidV160UpgradeProviderService } from './android-upgrade/android-v1.6.0-upgrade-provider.service';
import { NgModule } from 'angular-ts-decorators';

@NgModule({
  id: 'AndroidSharedModule',
  providers: [AndroidBookmarkService, AndroidPlatformService, AndroidStoreService, AndroidV160UpgradeProviderService]
})
export class AndroidSharedModule {}
