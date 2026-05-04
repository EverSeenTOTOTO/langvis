export interface TransportEventMap<T> {
  message: CustomEvent<T>;
  disconnect: Event;
  error: CustomEvent<string>;
}

export abstract class Transport<T> extends EventTarget {
  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract send(message: T): boolean;
  abstract close(): void;
  abstract readonly isConnected: boolean;
  abstract readonly isConnecting: boolean;

  addEventListener<K extends keyof TransportEventMap<T>>(
    type: K,
    listener: (ev: TransportEventMap<T>[K]) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    super.addEventListener(type, listener);
  }

  protected emit(name: 'message', detail: T): void;
  protected emit(name: 'disconnect'): void;
  protected emit(name: 'error', detail: string): void;
  protected emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
