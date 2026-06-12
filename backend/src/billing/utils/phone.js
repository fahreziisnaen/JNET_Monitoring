function normalizeWa(number) {
    if (!number) return '';
    let n = String(number).replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    if (n.startsWith('620')) n = '62' + n.slice(3);
    return n;
}

module.exports = { normalizeWa };
