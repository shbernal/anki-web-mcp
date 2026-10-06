import { type Message, readMessage } from "../src/ankiweb/protobuf.js";

/** The nested message at `field`, which a test expects to be there. */
export function nested(message: Message, field: number): Message {
  const inner = readMessage(message, field);
  if (inner === undefined) {
    throw new Error(`No message in field ${field}`);
  }
  return inner;
}
