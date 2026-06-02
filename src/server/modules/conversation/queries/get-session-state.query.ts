import { Query } from '@/server/libs/ddd';

export class GetSessionStateQuery extends Query {
  constructor(readonly conversationId: string) {
    super();
  }
}
