import { AppSearchComponent } from '../../../app/app-search/app-search.component';
import { WebExtAppHelperService } from '../shared/webext-app-helper/webext-app-helper.service';
import { Component } from 'angular-ts-decorators';
import { boundMethod } from 'autobind-decorator';

@Component({
  controllerAs: 'vm',
  selector: 'appSearch',
  template: require('../../../app/app-search/app-search.component.html')
})
export class WebExtAppSearchComponent extends AppSearchComponent {
  appHelperSvc: WebExtAppHelperService;

  ngOnInit(): ng.IPromise<void> {
    // Check if current url is bookmarked
    return (
      this.appHelperSvc
        .currentUrlBookmarked()
        .then((currentUrlBookmarked) => {
          this.currentUrlBookmarked = currentUrlBookmarked;
        })
        .then(() => super.ngOnInit())
        // Focus on search box
        .then(() => this.appHelperSvc.focusOnElement('input[name=txtSearch]'))
    );
  }

  @boundMethod
  toggleBookmarkTreeView(): ng.IPromise<void> {
    return (
      super
        .toggleBookmarkTreeView()
        // Focus on search box
        .then(() => this.appHelperSvc.focusOnElement('input[name=txtSearch]'))
    );
  }
}
