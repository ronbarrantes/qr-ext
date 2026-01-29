EXT_DIR := clipboard-qr-extension
DIST_DIR := dist
ZIP_NAME := cb-qr-ext.zip
ZIP_PATH := $(DIST_DIR)/$(ZIP_NAME)

.PHONY: all clean zip verify

all: zip

clean:
	rm -rf "$(DIST_DIR)"

$(ZIP_PATH):
	@test -f "$(EXT_DIR)/manifest.json"
	@test -f "$(EXT_DIR)/popup.html"
	@test -f "$(EXT_DIR)/popup.js"
	@test -f "$(EXT_DIR)/qrcode.min.js"
	@mkdir -p "$(DIST_DIR)"
	@cd "$(EXT_DIR)" && zip -r "../$(ZIP_PATH)" . \
		-x "**/.DS_Store" \
		-x "**/__MACOSX/**" \
		-x "**/*.zip"

verify: $(ZIP_PATH)
	@unzip -Z -1 "$(ZIP_PATH)" | grep -qx 'manifest.json'
	@if unzip -Z -1 "$(ZIP_PATH)" | grep -qE '\.zip$$'; then \
		echo "Zip contains a nested .zip file; failing."; \
		exit 1; \
	fi
	@if unzip -Z -1 "$(ZIP_PATH)" | grep -q '^$(EXT_DIR)/'; then \
		echo "Zip contents are nested under $(EXT_DIR)/; failing."; \
		exit 1; \
	fi

zip: $(ZIP_PATH) verify
