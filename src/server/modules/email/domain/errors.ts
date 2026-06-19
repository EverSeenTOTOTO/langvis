import { ExceptionBase } from '@/server/libs/exceptions/exception.base';

export class EmailNotFoundError extends ExceptionBase {
  readonly code = 'EMAIL_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Email ${id} not found`);
  }
}

export class MissingRawEmailContentError extends ExceptionBase {
  readonly code = 'MISSING_RAW_EMAIL_CONTENT';
  readonly statusCode = 400;
  constructor() {
    super('Missing raw email content');
  }
}
