.PHONY: all install run test clean

all: run test

install:
	pip install -r requirements.txt

run:
	PYTHONPATH=. python3 -m experiments.run_experiments

test:
	@if command -v pytest >/dev/null 2>&1; then \
		PYTHONPATH=. pytest -v; \
	else \
		PYTHONPATH=. python3 -m unittest discover -s tests -t . -v; \
	fi

clean:
	rm -rf __pycache__ */__pycache__
