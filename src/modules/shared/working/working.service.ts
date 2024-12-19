import { WorkingContext } from './working.enum';
import { WorkingStatus } from './working.interface';
import { Injectable } from 'angular-ts-decorators';

@Injectable('WorkingService')
export class WorkingService {
  status: WorkingStatus;

  constructor() {
    this.status = {
      activated: false
    };
  }

  hide(): void {
    this.status = {
      activated: false
    };
  }

  show(context?: WorkingContext): void {
    this.status = {
      activated: true,
      context
    };
  }
}
