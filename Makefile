PATH := ./node_modules/.bin:${PATH}

.PHONY : init clean build

init:
	npm install

clean:
	rm -rf lib/

build:
	coffee -o lib/ -c src/