/**
 * A codec whose steps may be asynchronous, such as Web Crypto encryption.
 * Every Codec is also an AsyncCodec. Used by createAsyncVault.
 */
interface AsyncCodec {
  /** Runs on write, after JSON serialization. */
  encode(text: string): string | Promise<string>;
  /** Runs on read, before JSON parsing. Must invert `encode`. */
  decode(text: string): string | Promise<string>;
}

interface ComposedAsyncCodec {
  encode(text: string): Promise<string>;
  decode(text: string): Promise<string>;
}

/** Encodes left to right and decodes right to left, awaiting each step. */
function composeAsyncCodecs(codecs: readonly AsyncCodec[]): ComposedAsyncCodec {
  const reversed = [...codecs].reverse();
  return {
    encode: async (text) => {
      let result = text;
      for (const codec of codecs) result = await codec.encode(result);
      return result;
    },
    decode: async (text) => {
      let result = text;
      for (const codec of reversed) result = await codec.decode(result);
      return result;
    },
  };
}

export { composeAsyncCodecs };
export type { AsyncCodec, ComposedAsyncCodec };
