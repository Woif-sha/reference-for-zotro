export class StructuredOutputUnsupportedError extends Error {
  readonly code = "analysis_structured_output_unsupported";

  constructor(cause?: unknown) {
    super("analysis_structured_output_unsupported", {
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = "StructuredOutputUnsupportedError";
  }
}

export function rejectsStructuredOutput(
  status: number,
  detail: string,
): boolean {
  if (![400, 404, 422].includes(status)) return false;
  return (
    /response[_ ]format|json[_ ]object|text\.format|structured output/iu.test(
      detail,
    ) &&
    /not support|unsupported|unknown|invalid|unrecognized|not allowed/iu.test(
      detail,
    )
  );
}
