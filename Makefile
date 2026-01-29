ZIP_NAME ?= cb-qr-ext.zip
SRC_DIR  ?= clipboard-qr-extension
DIST_DIR ?= dist

.PHONY: zip clean

zip: $(DIST_DIR)/$(ZIP_NAME)

$(DIST_DIR)/$(ZIP_NAME):
	@mkdir -p "$(DIST_DIR)"
	@cd "$(SRC_DIR)" && zip -r "../$(DIST_DIR)/$(ZIP_NAME)" . \
		-x "**/.DS_Store" \
		-x "**/__MACOSX/**"

clean:
	@rm -rf "$(DIST_DIR)"
