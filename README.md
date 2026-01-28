# Clipboard QR Code Extension

A simple Chrome extension that generates QR codes from your clipboard content.

## Features

- **Clipboard Integration**: Automatically reads the last copied text when you open the popup
- **Text Input**: Enter or paste custom text to generate a QR code
- **Live Updates**: QR code updates in real-time as you type
- **Clean UI**: Minimal, modern design that stays out of your way

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the `clipboard-qr-extension` folder

## Usage

1. Click the extension icon in your Chrome toolbar
2. The popup will automatically show a QR code of your most recent clipboard text
3. You can type or paste different text in the input field to generate a new QR code

## Files

```
clipboard-qr-extension/
├── manifest.json      # Extension configuration
├── popup.html         # Popup UI structure
├── popup.css          # Styling
├── popup.js           # Extension logic
├── qrcode.min.js      # QR code generation library
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Permissions

- `clipboardRead`: Required to read text from your clipboard

## License

MIT
