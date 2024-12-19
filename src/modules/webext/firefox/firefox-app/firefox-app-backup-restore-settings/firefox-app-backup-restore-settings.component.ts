import { WebExtAppBackupRestoreSettingsComponent } from '../../../webext-app/webext-app-backup-restore-settings/webext-app-backup-restore-settings.component';
import { Component } from 'angular-ts-decorators';

@Component({
  controllerAs: 'vm',
  selector: 'backupRestoreSettings',
  styles: [require('../../../../app/app-settings/backup-restore-settings/backup-restore-settings.component.scss')],
  template: require('../../../../app/app-settings/backup-restore-settings/backup-restore-settings.component.html')
})
export class FirefoxAppBackupRestoreSettingsComponent extends WebExtAppBackupRestoreSettingsComponent {
  autoBackUpFormComplete(): void {
    super.autoBackUpFormComplete();
    this.confirmAutoBackUpForm();
  }
}
