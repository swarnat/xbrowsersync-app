import { Alert } from './alert.interface';
import { Injectable } from 'angular-ts-decorators';

@Injectable('AlertService')
export class AlertService {
  private _currentAlert: Alert | undefined;

  get currentAlert(): Alert | undefined {
    return this._currentAlert;
  }

  set currentAlert(value: Alert) {
    this._currentAlert = value;
  }

  clearCurrentAlert(): void {
    this.currentAlert = undefined;
  }
}
