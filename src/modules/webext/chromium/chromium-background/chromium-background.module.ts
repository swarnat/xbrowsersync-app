import { WebExtBackgroundModule } from '../../webext-background/webext-background.module';
import { ChromiumBookmarkService } from '../shared/chromium-bookmark/chromium-bookmark.service';
import { ChromiumPlatformService } from '../shared/chromium-platform/chromium-platform.service';
import angular from 'angular';
import { NgModule } from 'angular-ts-decorators';

@NgModule({
  id: 'ChromiumBackgroundModule',
  imports: [WebExtBackgroundModule],
  providers: [ChromiumBookmarkService, ChromiumPlatformService]
})
class ChromiumBackgroundModule {}

angular.element(document).ready(() => {
  angular.bootstrap(document, [(ChromiumBackgroundModule as NgModule).module.name]);
});
