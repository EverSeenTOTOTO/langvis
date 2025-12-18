export interface Tool {
  name: string;
  description: string;

  call(input: Record<string, any>): Promise<unknown>;

  streamCall(
    input: Record<string, any>,
    outputStream: WritableStream,
  ): Promise<unknown>;
}

export type ToolConstructor = new () => Tool;
