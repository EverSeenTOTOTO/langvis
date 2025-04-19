import { singleton } from 'tsyringe';

@singleton()
export class SSEService {
  sendMessage: (event: string, data: any) => void = () => {
    throw new Error('Not connected');
  };

  setSendMessage(sendMessage: (event: string, data: any) => void) {
    this.sendMessage = sendMessage;
  }
}
