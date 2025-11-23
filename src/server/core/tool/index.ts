export interface Tool {
  call(input: Record<string, any>): Promise<unknown>;

  streamCall(
    input: Record<string, any>,
    outputStream: WritableStream,
  ): Promise<unknown>;
}

export type ToolConstructor = (new () => Tool) & {
  Name: string;
  Description: string;
};
