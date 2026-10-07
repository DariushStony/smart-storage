/**
 * UTF-8 length of a string without allocating an encoded copy. Lone
 * surrogates count as U+FFFD (3 bytes), matching TextEncoder.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export { utf8ByteLength };
