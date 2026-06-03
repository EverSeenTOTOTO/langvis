import { Command } from '@/server/libs/ddd';

export class ArchiveEmailCommand extends Command {
  constructor(
    readonly emailId: string,
    readonly userId: string,
  ) {
    super();
  }
}

export interface ArchiveEmailResult {
  conversationId: string;
}
