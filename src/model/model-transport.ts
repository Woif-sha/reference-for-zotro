export type ModelResponseFormat = "text" | "json_object";

export type TextModelResult = Readonly<{ text: string }>;

export const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
export const DEFAULT_STREAM_MAX_BYTES = 128 * 1024;
export const DEFAULT_OUTPUT_MAX_CHARACTERS = 32_768;

export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error(`${label} exceeded the ${maxBytes}-byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try {
      await reader.cancel();
    } catch (cancelError) {
      throw new AggregateError(
        [error, cancelError],
        `${label} and cancellation both failed`,
        { cause: cancelError },
      );
    }
    throw error;
  }
}
