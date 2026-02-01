# Makefile for packaging clipboard QR extension

EXTENSION_DIR = clipboard-qr-extension
DIST_DIR = dist
ZIP_FILE = $(DIST_DIR)/cb-qr-ext.zip

.PHONY: clean zip verify all test

all: clean zip

clean:
	@echo "Cleaning dist directory..."
	@rm -rf $(DIST_DIR)
	@mkdir -p $(DIST_DIR)

zip: clean
	@echo "Creating zip file from $(EXTENSION_DIR)..."
	@cd $(EXTENSION_DIR) && zip -r ../$(ZIP_FILE) . -x "*.git*"
	@echo "Zip file created: $(ZIP_FILE)"

verify: zip
	@echo "Verifying zip file..."
	@if [ ! -f $(ZIP_FILE) ]; then \
		echo "Error: zip file not found"; \
		exit 1; \
	fi
	@echo "Zip file contents:"
	@unzip -l $(ZIP_FILE) | head -20
	@echo "Zip file verified successfully"

test:
	@npm test
