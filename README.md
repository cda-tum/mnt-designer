[![PyPI](https://img.shields.io/pypi/v/mnt.designer?logo=pypi&style=flat-square)](https://pypi.org/project/mnt.designer/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bindings](https://img.shields.io/github/actions/workflow/status/cda-tum/mnt-designer/deploy.yml?branch=main&style=flat-square&logo=github&label=python)](https://github.com/cda-tum/mnt-designer/actions/workflows/deploy.yml)
[![Code style: black][black-badge]][black-link]

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
previously separate stages such as physical design, “on-the-
fly” gate design, and verification in a graphical user inter-
face, the tool streamlines an otherwise fragmented workflow.
Specifically, it enables researchers and designers to import
and edit high-level logic descriptions, generate and refine
gate-level layouts, verify design-rule compliance, and export
completed designs for simulation and fabrication.
The modularity and scalability of the proposed approach
accommodate both exact and heuristic algorithms, offering
flexibility in tackling the wide range of problems and con-
straints inherent to FCN technologies. The ability to manu-
ally adjust layouts alongside automated post-layout optimiza-
tion algorithms further empowers experts to explore custom
solutions for performance-critical or domain-specific designs.
Moreover, the integrated gate-design functionality for SiDBs
facilitates rapid prototyping and testing of new concepts.
Overall, by integrating these capabilities into a single, user-
friendly environment, the presented tool fills a critical gap in
existing FCN design tools. It thereby accelerates research and
development in nanoscale computing, ultimately paving the
way for more efficient, reliable, and scalable FCN circuits.

Related publication presented at DATE: [paper](https://www.cda.cit.tum.de/files/eda/2025_date_physical_co-design_for_fcn.pdf) and IEEE-NANO: [paper](https://www.cda.cit.tum.de/files/eda/2025_ieee_nano_mnt_designer.pdf).

# Usage of MNT Designer

If you do not have a virtual environment set up, the following steps outline one possible way to do so.
First, install virtualenv:

```console
$ pip install virtualenv
```

Then create a new virtual environment in your project folder and activate it:

```console
$ mkdir mnt_designer
$ cd mnt_designer
$ python -m venv venv
$ source venv/bin/activate
```

MNT Designer can be installed via pip:

```console
(venv) $ pip install mnt.designer
```

and then started locally using this command:

```
(venv) $ mnt.designer
```

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

[black-badge]: https://img.shields.io/badge/code%20style-black-000000.svg
[black-link]: https://github.com/psf/black
