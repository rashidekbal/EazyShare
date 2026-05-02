const QRCode = require('qrcode');

async function generateQRCode(url) {
  return QRCode.toDataURL(url, {
    width: 280,
    margin: 1,
    color: { dark: '#ffffff', light: '#00000000' },
    errorCorrectionLevel: 'M',
  });
}

module.exports = { generateQRCode };
