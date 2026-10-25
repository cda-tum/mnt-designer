[![PyPI](https://img.shields.io/pypi/v/mnt.designer?logo=pypi&style=flat-square)](https://pypi.org/project/mnt.designer/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bindings](https://img.shields.io/github/actions/workflow/status/cda-tum/mnt-designer/deploy.yml?branch=main&style=flat-square&logo=github&label=python)](https://github.com/cda-tum/mnt-designer/actions/workflows/deploy.yml)
[![Code style: Ruff][ruff-badge]][ruff-link]

# MNT Designer: A Comprehensive Design Tool for Field-coupled Nanocomputing (FCN)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cda-tum/mnt-nanoplacer/main/docs/_static/mnt_light.svg" width="60%">
    <img src="https://raw.githubusercontent.com/cda-tum/mnt-nanoplacer/main/docs/_static/mnt_dark.svg" width="60%">
  </picture>
</p>

MNT Designer is a comprehensive, fully open-source,
GUI-based tool that advances the design of Field-coupled
Nanocomputing circuits from high-level logic specifications
through to fabrication-ready, cell-level layouts. By unifying
previously separate stages such as physical design, “on-the-fly”
gate design, and verification in a graphical user interface,
the tool streamlines an otherwise fragmented workflow.
Specifically, it enables researchers and designers to import
and edit high-level logic descriptions, generate and refine
gate-level layouts, verify design-rule compliance, and export
completed designs for simulation and fabrication.
The modularity and scalability of the proposed approach
accommodate both exact and heuristic algorithms, offering
flexibility in tackling the wide range of problems and constraints
inherent to FCN technologies. The ability to manually adjust layouts
alongside automated post-layout optimization algorithms further empowers experts to explore custom
solutions for performance-critical or domain-specific designs.
Moreover, the integrated gate-design functionality for SiDBs
facilitates rapid prototyping and testing of new concepts.
Overall, by integrating these capabilities into a single, user-friendly
environment, the presented tool fills a critical gap in
existing FCN design tools. It thereby accelerates research and
development in nanoscale computing, ultimately paving the
way for more efficient, reliable, and scalable FCN circuits.

Related publication presented at DATE: [paper](https://www.cda.cit.tum.de/files/eda/2025_date_physical_co-design_for_fcn.pdf) and IEEE-NANO: [paper](https://www.cda.cit.tum.de/files/eda/2025_ieee_nano_mnt_designer.pdf).

# Usage of MNT Designer

MNT Designer supports Python 3.11–3.14 and uses the published [pyfiction](https://pypi.org/project/mnt.pyfiction/) 0.8.0 package.

## Recommended: install with uv

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) 0.13.5 or newer, then run:

```console
$ uv tool install --python 3.13 mnt.designer
$ mnt-designer
```

uv manages an isolated environment; no activation is needed. It can download Python if it is missing, and the explicit
Python version keeps the installation within the supported range. If `mnt-designer` is not on your PATH, run
`uv tool update-shell` and restart your terminal. Update with `uv tool upgrade mnt.designer`.

To try Designer without a persistent tool installation:

```console
$ uvx --python 3.13 --from mnt.designer mnt-designer
```

The first run downloads dependencies; later runs reuse uv's cache. Export layouts you want to keep before stopping the
server with Ctrl+C. Tool environments are isolated: for Python imports or development, use the project environment
described below instead.

## Alternative: pip

Create a virtual environment using your Python installation:

```console
$ python3 -m venv .venv
$ source .venv/bin/activate
```

For fish, activate with `source .venv/bin/activate.fish` instead. On Windows PowerShell, use `.venv\Scripts\Activate.ps1`.
Install and start Designer:

```console
$ python -m pip install --upgrade mnt.designer
$ mnt-designer
```

The interface opens at <http://127.0.0.1:5001>. The original `mnt.designer` command remains supported.
Use `--help` to see the options, or choose another port and open the browser yourself:

```console
$ mnt-designer --port 5053 --no-browser
```

## SiDB gate design

This optional feature needs a source build of pyfiction at
[`509b20aa`](https://github.com/cda-tum/fiction/commit/509b20aa86e4fc24f71cad8f8d38eb5c4d72823c), the commit that introduced
shared design timeouts. Standard installs use pyfiction 0.8.0 and provide all other tools, including Bestagon export.
To enable gate design, clone this repository, create a separate Python 3.13 project environment, and launch Designer
from that environment (not the standard `uv tool` installation):

```console
$ uv venv --python 3.13
$ uv pip install --python .venv --override requirements-sidb-design.txt -e '.[test]'
$ uv run --no-project --python .venv mnt-designer
```

This opt-in build requires a C++20 compiler. The pin deliberately excludes later, incompatible Python API changes.

Choose **Export → Design SiDB gates…** to synthesize SiDB implementations for the current gate-level layout.
Gate design requires 2DDWave clocking and a layout without design-rule errors.
Designer converts the layout to hexagonal form and offers SVG or SiQAD (`.sqd`) downloads. The gate-level layout and
Verilog remain unchanged. **SiDB layout (Bestagon)** exports the predefined Bestagon library without a gate search.

The search defaults to QuickCell with three canvas SiDBs per gate. You can choose one to three SiDBs or use exhaustive or
random search. Physical parameters are adjustable: relative permittivity εᵣ (default 5.6), Thomas–Fermi screening length
λTF (5.0 nm), charge-transition energy μ₋ (−0.32 eV), and two or three charge states (default three).
Designer uses the default Bestagon canvas and predefined complex gates where possible at the default physical settings.
Changing any physical parameter also searches for crossings and double wires under those conditions, using three canvas
SiDBs for these complex gates. QuickCell and exhaustive search stop after the first solution; random search evaluates at
most 10,000 candidates per gate. Some gate types and orientations are unsupported, and a search may find no implementation.
Designer runs one search at a time in a separate process. Choose a search timeout of 1–55 seconds (default 55).
Fiction shares this budget across the whole circuit, including all gate searches and nested simulations; it does not
restart the budget for each gate. Native deadline checks are cooperative. Designer allows five extra seconds for worker
startup and export, then kills the process if it has not exited. Either timeout returns no partial circuit.
Closing the settings dialog does not cancel the search. Editing can continue; the download uses the layout snapshot
cloned before serialization when the search started.

## Development

Clone the repository and install it in an isolated project environment:

```console
$ git clone https://github.com/cda-tum/mnt-designer.git
$ cd mnt-designer
$ uv venv --python 3.13
$ uv pip install --python .venv -e '.[test]'
$ uv run --no-project --python .venv python -m pytest
$ uv run --no-project --python .venv mnt-designer
```

Alternatively, activate a Python 3.11–3.14 virtual environment and use `python -m pip install -e '.[test]'`.
The editable installation is needed to share the `mnt` namespace with pyfiction; setting `PYTHONPATH` alone is not sufficient.
Run the repository checks with `pre-commit run --all-files` after installing [pre-commit](https://pre-commit.com/).

Package CI builds with uv and the existing setuptools backend, tests wheel installs with uv and source installs with pip,
and checks both `uv tool install` and `uvx` against the published pyfiction 0.8.0 dependency. Publishing is unchanged.
A separate integration job builds the optional SiDB pin
and checks native gate design and timeout handling. The native gate-design tests skip when that capability is absent;
the remaining tests run with either build.

## Hosting notes

The built-in server is intended for local use and binds to loopback by default. For deployment, use a production WSGI
server with `mnt.designer.app:app` and **one worker process**: layouts and logic networks are held in process-local memory,
not shared between workers, and are lost when the server restarts. Export work you want to keep.

Only loopback hostnames are accepted by default. An explicit non-wildcard `--host` is also accepted. For a reverse proxy
or wildcard bind, set `MNT_DESIGNER_TRUSTED_HOSTS` to the comma-separated public hostnames (for example,
`designer.example.org`), and preserve the original Host header. This blocks requests using unrelated hostnames.
The frontend sends a session-bound token on every POST; scripts must first GET `/`, retain its session cookie, and send
the page's `csrf-token` value in `X-CSRF-Token`. These protections are not authentication: restrict access to hosted
instances at the reverse proxy. Design pages and downloads are not cached, and embedding Designer in an iframe is blocked.

Request-body reads are limited to 5 MiB, including multipart upload overhead, before native layout or Verilog parsing.
Rejected imports and editor saves leave the current layout and code unchanged. Configure a matching request-size limit
in your reverse proxy when hosting Designer, including for streamed requests without a content length.

Designer generates a random session secret at startup. Set `MNT_DESIGNER_SECRET_KEY` to a securely generated secret if you
need a stable signing key; this does not make the in-memory layouts persistent. See Flask's
[deployment guidance](https://flask.palletsprojects.com/en/stable/deploying/) before exposing the application publicly.

# References

In case you are using MNT Designer in your work, we would be thankful if you referred to it by citing the following publications:

```bibtex
@INPROCEEDINGS{hofmann2025codesign,
  author        = {S. Hofmann and M. Walter and R. Wille},
  title         = {{Late Breaking Results: Physical Co-Design for Field-coupled Nanocomputing}},
  booktitle     = {{Design, Automation and Test in Europe (DATE)}},
  year          = {2025},
}
```

```bibtex
@INPROCEEDINGS{hofmann2025mntdesigner,
  author        = {S. Hofmann and J. Drewniok and M. Walter and R. Wille},
  title         = {{MNT Designer: A Comprehensive Design Tool for Field-coupled Nanocomputing}},
  booktitle     = {{International Conference on Nanotechnology (IEEE Nano)}},
  year          = {2025},
}
```

[ruff-badge]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json
[ruff-link]: https://github.com/astral-sh/ruff

## Installation, browser, and dependency checks

CI smoke-tests built wheels on macOS ARM and Windows x64 with Python 3.13; the existing Linux jobs cover the
minimum and maximum supported Python versions. One Chromium workflow checks the real interface, and a separate
job audits freshly resolved runtime dependencies (including transitive dependencies) with `pip-audit` on PRs,
main, and weekly. Browser failure traces are retained for seven days; these tests use temporary data only.

To run the browser check locally after creating the development environment:

```console
uv pip install --python .venv pytest-playwright
uv run --no-project --python .venv python -m playwright install chromium
uv run --no-project --python .venv python -m pytest tests/browser_smoke.py
```

The browser test imports Verilog, edits it, creates an orthogonal layout, and downloads the FGL file.
It needs network access to the same integrity-pinned frontend assets as the application.
