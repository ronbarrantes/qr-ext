// DOM Elements
const qrCodeContainer = document.getElementById('qr-code');
const emptyMessage = document.getElementById('empty-message');
const textInput = document.getElementById('text-input');
const statusEl = document.getElementById('status');

let qrCodeInstance = null;

// Generate or update QR code
function generateQRCode(text) {
  // Clear existing QR code
  qrCodeContainer.innerHTML = '';
  
  if (!text || text.trim() === '') {
    qrCodeContainer.classList.add('hidden');
    emptyMessage.classList.remove('hidden');
    return;
  }
  
  qrCodeContainer.classList.remove('hidden');
  emptyMessage.classList.add('hidden');
  
  try {
    qrCodeInstance = new QRCode(qrCodeContainer, {
      text: text,
      width: 150,
      height: 150,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    showStatus('QR code generated', 'success');
  } catch (error) {
    showStatus('Error generating QR code', 'error');
    console.error('QR Code generation error:', error);
  }
}

// Show status message
function showStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) {
    statusEl.classList.add(type);
  }
  
  // Clear status after 2 seconds
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 2000);
}

// Read from clipboard
async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      textInput.value = text;
      generateQRCode(text);
      showStatus('Loaded from clipboard', 'success');
    } else {
      showStatus('Clipboard is empty', '');
    }
  } catch (error) {
    // Clipboard access may be denied
    console.log('Could not read clipboard:', error);
    showStatus('Click in the text area to paste', '');
  }
}

// Handle text input changes
function handleInputChange() {
  const text = textInput.value;
  generateQRCode(text);
}

// Debounce function to avoid too many QR code generations
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Debounced input handler
const debouncedInputChange = debounce(handleInputChange, 300);

// Event listeners
textInput.addEventListener('input', debouncedInputChange);

// Try to read clipboard when popup opens
document.addEventListener('DOMContentLoaded', () => {
  readClipboard();
});
