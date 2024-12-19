import { WebpageMetadata } from '../global-shared.interface';
import { getMetadata } from './get-metadata';
import { Injectable } from 'angular-ts-decorators';

@Injectable('MetadataService')
export class MetadataService {
  getMetadata(url: string, html: string): WebpageMetadata {
    return getMetadata(url, html);
  }
}
