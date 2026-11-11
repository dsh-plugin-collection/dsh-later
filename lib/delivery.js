import { readEventAt, readLogCursor, readOwnEvents } from './upstream-compat.js';
export const DELIVERY_CONFIRM_TIMEOUT_MS = 2000;
const CONFIRM_POLL_INTERVAL_MS = 25;
function eventCarriesMessage(event, messageId) {
    const data = event.data;
    if (data === null || typeof data !== 'object')
        return false;
    const record = data;
    if (record.id === messageId)
        return true;
    const nested = record.message;
    return nested !== null && typeof nested === 'object' && nested.id === messageId;
}
export function hasMessageInLog(session, messageId) {
    try {
        for (const event of readOwnEvents(session)) {
            if (eventCarriesMessage(event, messageId))
                return true;
        }
    }
    catch {
        return false;
    }
    return false;
}
function scanFrom(session, messageId, fromSeq) {
    const cursor = readLogCursor(session);
    let seq = Math.max(fromSeq, cursor.offset);
    if (cursor.tail < seq) {
        return { found: hasMessageInLog(session, messageId), next: cursor.tail };
    }
    while (seq < cursor.tail) {
        const at = seq;
        seq += 1;
        let event;
        try {
            event = readEventAt(session, at);
        }
        catch {
            return { found: false, next: seq };
        }
        if (event !== undefined && eventCarriesMessage(event, messageId)) {
            return { found: true, next: seq };
        }
    }
    return { found: false, next: seq };
}
export async function confirmDelivery(session, messageId, timeoutMs = DELIVERY_CONFIRM_TIMEOUT_MS) {
    if (hasMessageInLog(session, messageId))
        return true;
    let cursorSeq = readLogCursor(session).tail;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS);
        });
        const scanned = scanFrom(session, messageId, cursorSeq);
        cursorSeq = scanned.next;
        if (scanned.found)
            return true;
    }
    return false;
}
export function messageIdOf(message) {
    const id = message.id;
    return typeof id === 'string' ? id : '';
}
