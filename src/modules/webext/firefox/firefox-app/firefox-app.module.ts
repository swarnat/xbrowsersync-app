import { WebExtAppModule } from '../../webext-app/webext-app.module';
import { FirefoxBookmarkService } from '../shared/firefox-bookmark/firefox-bookmark.service';
import { FirefoxPlatformService } from '../shared/firefox-platform/firefox-platform.service';
import { FirefoxAppBackupRestoreSettingsComponent } from './firefox-app-backup-restore-settings/firefox-app-backup-restore-settings.component';
import { FirefoxAppHelperService } from './shared/firefox-app-helper/firefox-app-helper.service';
import angular from 'angular';
import { NgModule } from 'angular-ts-decorators';

@NgModule({
  declarations: [FirefoxAppBackupRestoreSettingsComponent],
  id: 'FirefoxAppModule',
  imports: [WebExtAppModule],
  providers: [FirefoxAppHelperService, FirefoxBookmarkService, FirefoxPlatformService]
})
class FirefoxAppModule {}

angular.element(document).ready(() => {
  angular.bootstrap(document, [(FirefoxAppModule as NgModule).module.name], { strictDi: true });
});
