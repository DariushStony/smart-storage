/**
 * A reversible string transform applied to the whole stored blob:
 * compression, encoding, and so on. Must be synchronous.
 */
interface Codec {
  /** Runs on write, after JSON serialization. */
  encode(text: string): string;
  /** Runs on read, before JSON parsing. Must invert `encode`. */
  decode(text: string): string;
}

const identityCodec: Codec = {
  encode: (text) => text,
  decode: (text) => text,
};

/** Encodes left to right; decodes right to left. */
function composeCodecs(codecs: readonly Codec[]): Codec {
  if (codecs.length === 0) return identityCodec;

  return {
    encode: (text) => codecs.reduce((acc, codec) => codec.encode(acc), text),
    decode: (text) =>
      codecs.reduceRight((acc, codec) => codec.decode(acc), text),
  };
}

export { composeCodecs };
export type { Codec };
