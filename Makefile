
JSHINT = ./node_modules/.bin/jshint

JS_FILES = \
	jirapub.js

.PHONY: all
all: 0-npm-stamp

.PHONY: check
check: $(JSHINT)
	$(JSHINT) $(JS_FILES)

$(JSHINT):
	npm install \
	    jshint@`json -f package.json devDependencies.jshint`

0-npm-stamp:
	npm install
	touch $@

