const WIRE_TYPE_BITS = 3n;
const WIRE_TYPE_MASK = 0b111n;
const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;
const FIXED64_BYTES = 8;
const FIXED32_BYTES = 4;
const FIXED_WIDTHS: ReadonlyMap<number, number> = new Map([
  [FIXED64, FIXED64_BYTES],
  [FIXED32, FIXED32_BYTES],
]);
const PAYLOAD_BITS = 7n;
const PAYLOAD_MASK = 0x7f;
const CONTINUATION_BIT = 0x80;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * One decoded protobuf message, keyed by field number. Varints stay `bigint` so
 * an `int64` survives, and length-delimited fields stay bytes, because only the
 * schema knows whether they hold a string or a nested message. Fixed-width
 * fields are skipped: none of AnkiWeb's messages read here use them.
 */
export type Message = ReadonlyMap<number, readonly (bigint | Uint8Array)[]>;

export class ProtobufError extends Error {
  override name = "ProtobufError";
}

function readVarint(bytes: Readonly<Uint8Array>, start: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  for (;;) {
    const byte = bytes[offset];
    if (byte === undefined) {
      throw new ProtobufError("Truncated varint");
    }
    offset += 1;
    value |= BigInt(byte & PAYLOAD_MASK) << shift;
    if ((byte & CONTINUATION_BIT) === 0) {
      return [value, offset];
    }
    shift += PAYLOAD_BITS;
  }
}

/** Reads the field at `offset`: its number, its value (none for fixed-width fields), and where the next one starts. */
function readField(
  bytes: Readonly<Uint8Array>,
  offset: number,
): [number, bigint | Uint8Array | undefined, number] {
  const [tag, start] = readVarint(bytes, offset);
  const field = Number(tag >> WIRE_TYPE_BITS);
  const wireType = Number(tag & WIRE_TYPE_MASK);
  if (wireType === VARINT) {
    return [field, ...readVarint(bytes, start)];
  }
  if (wireType === LENGTH_DELIMITED) {
    const [length, valueStart] = readVarint(bytes, start);
    const end = valueStart + Number(length);
    if (end > bytes.length) {
      throw new ProtobufError(`Field ${field} runs past the end of the message`);
    }
    return [field, bytes.subarray(valueStart, end), end];
  }
  const width = FIXED_WIDTHS.get(wireType);
  if (width !== undefined) {
    return [field, undefined, start + width];
  }
  throw new ProtobufError(`Unsupported wire type ${wireType} on field ${field}`);
}

export function decodeMessage(bytes: Readonly<Uint8Array>): Message {
  const fields = new Map<number, (bigint | Uint8Array)[]>();
  let offset = 0;
  while (offset < bytes.length) {
    const [field, value, next] = readField(bytes, offset);
    if (value !== undefined) {
      fields.set(field, [...(fields.get(field) ?? []), value]);
    }
    offset = next;
  }
  return fields;
}

function last(message: Message, field: number): bigint | Uint8Array | undefined {
  return message.get(field)?.at(-1);
}

function varint(message: Message, field: number): bigint | undefined {
  const value = last(message, field);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "bigint") {
    throw new ProtobufError(`Field ${field} is not a varint`);
  }
  return value;
}

function bytesOf(value: bigint | Uint8Array, field: number): Uint8Array {
  if (typeof value === "bigint") {
    throw new ProtobufError(`Field ${field} is not length-delimited`);
  }
  return value;
}

/** An unsigned integer or an `int64` timestamp, which fits a double until the year 285 616. */
export function readNumber(message: Message, field: number): number | undefined {
  const value = varint(message, field);
  return value === undefined ? undefined : Number(value);
}

export function readBool(message: Message, field: number): boolean {
  return (varint(message, field) ?? 0n) !== 0n;
}

export function readString(message: Message, field: number): string | undefined {
  const value = last(message, field);
  return value === undefined ? undefined : utf8.decode(bytesOf(value, field));
}

export function readMessage(message: Message, field: number): Message | undefined {
  const value = last(message, field);
  return value === undefined ? undefined : decodeMessage(bytesOf(value, field));
}

export function readMessages(message: Message, field: number): Message[] {
  return (message.get(field) ?? []).map((value) => decodeMessage(bytesOf(value, field)));
}
