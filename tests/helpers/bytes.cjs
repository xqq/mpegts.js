function concatBytes(...parts) {
    const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
    }
    return result;
}

module.exports = { concatBytes };
