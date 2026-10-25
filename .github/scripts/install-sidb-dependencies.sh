#!/usr/bin/env bash
set -euo pipefail

export CMAKE_BUILD_PARALLEL_LEVEL=2
uv pip install --python "$(command -v python)" --override requirements-sidb-design.txt -e '.[test]'
