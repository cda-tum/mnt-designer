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

MNT Designer supports Python 3.11–3.14 and uses [pyfiction](https://pypi.org/project/mnt.pyfiction/) 0.8.0 or newer.
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

## Development

Clone the repository and install it in a Python 3.11+ virtual environment:

```console
$ git clone https://github.com/cda-tum/mnt-designer.git
$ cd mnt-designer
$ python -m pip install -e '.[test]'
$ python -m pytest
$ mnt-designer
```

The editable installation is needed to share the `mnt` namespace with pyfiction; setting `PYTHONPATH` alone is not sufficient.
Run the repository checks with `pre-commit run --all-files` after installing [pre-commit](https://pre-commit.com/).

## Hosting notes

The built-in server is intended for local use and binds to loopback by default. For deployment, use a production WSGI
server with `mnt.designer.app:app` and **one worker process**: layouts and logic networks are held in process-local memory,
not shared between workers, and are lost when the server restarts. Export work you want to keep.

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
