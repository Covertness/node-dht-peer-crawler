PATH := ./node_modules/.bin:${PATH}
SRC = $(wildcard src/*.coffee)
SRCJS = $(wildcard src/*.js)
LIB = $(SRC:src/%.coffee=lib/%.js) $(SRCJS:src/%=lib/%)

.PHONY : init clean build

init:
	npm install

clean:
	@rm -r -f $(LIB)

build: $(LIB)

lib/%.js: src/%.js
	@cp $< $@

lib/%.js: src/%.coffee
	$(call coffeetime)

define coffeetime
	@mkdir -p $(@D)
	coffee -bcp $< > $@
endef